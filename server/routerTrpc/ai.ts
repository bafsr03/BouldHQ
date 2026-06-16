import { router, authProcedure, founderProcedure } from '../middleware';
import { userCaller } from './_app';
import { z } from 'zod';
import { AiService } from '@server/aiServer';
import { prisma } from '../prisma';
import { TRPCError } from '@trpc/server';
import { CoreMessage } from '@mastra/core';
import { RuntimeContext } from '@mastra/core/di';
import { AiModelFactory } from '@server/aiServer/aiModelFactory';
import { RebuildEmbeddingJob } from '../jobs/rebuildEmbeddingJob';
import { getAllPathTags } from '@server/lib/helper';
import { ModelCapabilities } from '@server/aiServer/types';
import { aiProviders, aiModels } from '@shared/lib/prismaZodType';
import { fetchWithProxy } from '@server/lib/proxy';
import { inferModelCapabilities } from '@shared/lib/modelTemplates';
import { isClaudeCodeConfigured } from '@server/aiServer/claudeCodeAgent';
import { expandSlashCommand } from '@server/aiServer/slashCommands';

export const aiRouter = router({
  // Reports whether the owner has wired up the Claude Code subscription.
  // Surfaced on the /ai page so the founder gets a clear error state when
  // the token isn't configured rather than an opaque 500.
  // Founder-only — the assistant has destructive powers; only the founder
  // is trusted to operate it.
  claudeCodeStatus: founderProcedure
    .query(async () => {
      return {
        configured: isClaudeCodeConfigured(),
      };
    }),

  embeddingUpsert: authProcedure
    .input(z.object({
      id: z.number(),
      content: z.string(),
      type: z.enum(['update', 'insert'])
    }))
    .mutation(async ({ input }) => {
      const { id, content, type } = input
      const createTime = await prisma.notes.findUnique({ where: { id } }).then(i => i?.createdAt)
      const { ok, error } = await AiService.embeddingUpsert({ id, content, type, createTime: createTime! })
      if (!ok) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error
        })
      }
      return { ok }
    }),

  embeddingInsertAttachments: authProcedure
    .input(z.object({
      id: z.number(),
      filePath: z.string() //api/file/text.pdf
    }))
    .mutation(async ({ input }) => {
      const { id, filePath } = input
      try {
        const res = await AiService.embeddingInsertAttachments({ id, filePath })
        return res
      } catch (error) {
        return { ok: false, msg: error?.message }
      }
    }),

  embeddingDelete: authProcedure
    .input(z.object({
      id: z.number()
    }))
    .mutation(async ({ input }) => {
      const { id } = input
      try {
        const res = await AiService.embeddingDelete({ id })
        return res
      } catch (error) {
        return { ok: false, msg: error?.message }
      }
    }),

  // BouldHQ assistant chat. Each call persists the user message + AI reply
  // into the existing conversation/message tables, tagged with
  // metadata.kind='assistant' so we can list/delete just these chats from a
  // sidebar without dragging in the broader Blinko completions history.
  // Founder-only — assistant has destructive tools (delete files, move
  // attachments, etc.). Other roles get a clear FORBIDDEN.
  assistantChat: founderProcedure
    .input(z.object({
      message: z.string().min(1),
      history: z.array(z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      })).default([]),
      conversationId: z.number().optional(),
      // Optional images attached to THIS turn. Each is a data URL
      // ("data:image/png;base64,...") under ~5MB. Not persisted to history
      // (keeps DB small + retains privacy by default); only used for the
      // current model call.
      images: z.array(z.object({
        dataUrl: z.string(),
        mimeType: z.string().optional(),
      })).default([]),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const accountId = Number(ctx.id);
        const agent = await AiModelFactory.BouldHqAssistantAgent();
        // Slash commands (e.g. /report joon) are expanded into a longer
        // instruction here so the agent gets a deterministic prompt. The
        // expander needs accountId + baseUrl (for /report which embeds
        // absolute logo URLs in the generated HTML). The ORIGINAL user
        // message is what we save to history.
        const headers = (ctx as any)?.req?.headers ?? {};
        const proto = headers['x-forwarded-proto'] || 'https';
        const host = headers['x-forwarded-host'] || headers.host || 'hq.bouldhq.com';
        const baseUrl = `${proto}://${host}`;
        const effectiveMessage = await expandSlashCommand(input.message, {
          accountId,
          baseUrl,
        });

        // Resolve or create the conversation row first so we always have an
        // id to attach messages to.
        let conversationId = input.conversationId;
        let isNewConversation = false;
        if (conversationId) {
          const existing = await prisma.conversation.findUnique({
            where: { id: conversationId },
            select: { accountId: true },
          });
          if (!existing || existing.accountId !== accountId) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found' });
          }
        } else {
          const title = input.message.length > 60
            ? input.message.slice(0, 57) + '…'
            : input.message;
          const created = await prisma.conversation.create({
            data: { title, accountId },
            select: { id: true },
          });
          conversationId = created.id;
          isNewConversation = true;
        }

        // Build the conversation. If images were attached this turn, the
        // current user message becomes a content-block array (image blocks
        // + text) so claudeCodeAgent's vision path picks it up.
        const currentTurn = input.images.length > 0
          ? {
              role: 'user' as const,
              content: [
                ...input.images.map((img) => ({
                  type: 'image' as const,
                  image: img.dataUrl,
                  mimeType: img.mimeType,
                })),
                { type: 'text' as const, text: effectiveMessage },
              ],
            }
          : { role: 'user' as const, content: effectiveMessage };

        const messages = [
          ...input.history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          currentTurn,
        ];
        const runtimeContext = new RuntimeContext();
        runtimeContext.set('accountId', accountId);
        const result = await agent.generate(messages as any, { runtimeContext });

        const toolCalls = (result.toolCalls ?? []).map((tc: any) => ({
          tool: tc.toolName,
          args: tc.args,
        }));
        const toolResults = (result.toolResults ?? []).map((tr: any) => ({
          tool: tr.toolName,
          result: tr.result,
        }));

        // Persist both turns. Store the ORIGINAL user message (pre-expansion)
        // so the history list reads the way the user typed it. Image
        // attachments are intentionally NOT persisted — they live only in
        // the current turn. The message metadata records how many images
        // were attached so the UI can show a placeholder.
        await prisma.message.create({
          data: {
            conversationId,
            role: 'user',
            content: input.message,
            metadata: {
              kind: 'assistant',
              ...(input.images.length > 0 ? { imageCount: input.images.length } : {}),
            },
          },
        });
        await prisma.message.create({
          data: {
            conversationId,
            role: 'assistant',
            content: result.text ?? '',
            metadata: { kind: 'assistant', toolCalls },
          },
        });

        // Touch the conversation so list ordering by updatedAt works.
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date() },
        });

        return {
          text: result.text ?? '',
          toolCalls,
          toolResults,
          conversationId,
          isNewConversation,
        };
      } catch (err: any) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: err?.message ?? 'Assistant call failed',
        });
      }
    }),

  // List the caller's assistant conversations, newest first. Filters by
  // message metadata so we don't surface unrelated Blinko-side conversations.
  // Founder-only.
  listAssistantConversations: founderProcedure
    .input(z.object({
      page: z.number().default(1),
      size: z.number().default(30),
    }).optional())
    .query(async ({ input, ctx }) => {
      const page = input?.page ?? 1;
      const size = input?.size ?? 30;
      const accountId = Number(ctx.id);
      const conversations = await prisma.conversation.findMany({
        where: {
          accountId,
          messages: {
            some: { metadata: { path: ['kind'], equals: 'assistant' } },
          },
        },
        skip: (page - 1) * size,
        take: size,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          title: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { messages: true } },
        },
      });
      return conversations.map((c) => ({
        id: c.id,
        title: c.title || '(untitled)',
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        messageCount: c._count.messages,
      }));
    }),

  // Load a single assistant conversation's full message list. Used when the
  // user clicks a row in the history sidebar. Founder-only.
  getAssistantConversation: founderProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const accountId = Number(ctx.id);
      const conv = await prisma.conversation.findFirst({
        where: { id: input.id, accountId },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });
      if (!conv) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found' });
      }
      return {
        id: conv.id,
        title: conv.title,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        messages: conv.messages.map((m) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          createdAt: m.createdAt,
          toolCalls: ((m.metadata as any)?.toolCalls ?? []) as Array<{ tool: string; args?: any }>,
        })),
      };
    }),

  // Founder-only.
  deleteAssistantConversation: founderProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const accountId = Number(ctx.id);
      const conv = await prisma.conversation.findFirst({
        where: { id: input.id, accountId },
        select: { id: true },
      });
      if (!conv) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found' });
      }
      await prisma.message.deleteMany({ where: { conversationId: conv.id } });
      await prisma.conversation.delete({ where: { id: conv.id } });
      return { success: true };
    }),

  completions: authProcedure
    .input(z.object({
      question: z.string(),
      withTools: z.boolean().optional(),
      withOnline: z.boolean().optional(),
      withRAG: z.boolean().optional(),
      conversations: z.array(z.object({ role: z.string(), content: z.string() })),
      systemPrompt: z.string().optional()
    }))
    .mutation(async function* ({ input, ctx }) {
      try {
        const { question, conversations, withTools = false, withOnline = false, withRAG = true, systemPrompt } = input
        let _conversations = conversations as CoreMessage[]
        const { result: responseStream, notes } = await AiService.completions({
          question,
          conversations: _conversations,
          ctx,
          withTools,
          withOnline,
          withRAG,
          systemPrompt
        })
        yield { notes }
        for await (const chunk of responseStream.fullStream) {
          yield { chunk }
        }
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error?.message
        })
      }
    }),

  speechToText: authProcedure
    .input(z.object({
      filePath: z.string()
    }))
    .mutation(async function ({ input }) {
      // const { filePath } = input
      // try {
      //   const localFilePath = await FileService.getFile(filePath)
      //   const doc = await AiService.speechToText(localFilePath)
      //   return doc
      // } catch (error) {
      //   throw new Error(error)
      // }
    }),

  rebuildingEmbeddings: authProcedure
    .input(z.object({
      force: z.boolean().optional()
    }))
    .mutation(async function* ({ input }) {
      const { force } = input
      try {
        for await (const result of AiService.rebuildEmbeddingIndex({ force })) {
          yield result;
        }
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error?.message
        })
      }
    }),

  summarizeConversationTitle: authProcedure
    .input(z.object({
      conversations: z.array(z.object({ role: z.string(), content: z.string() })),
      conversationId: z.number()
    }))
    .mutation(async function ({ input }) {
      const { conversations, conversationId } = input
      const agent = await AiModelFactory.SummarizeAgent()
      const conversationString = JSON.stringify(
        conversations.map(i => ({
          role: i.role,
          content: i.content.replace(/\n/g, '\\n')
        })),
        null, 2
      );
      const result = await agent.generate(conversationString)
      const conversation = await prisma.conversation.update({
        where: { id: conversationId },
        data: { title: result?.text }
      })
      return conversation
    }),

  writing: authProcedure
    .input(z.object({
      question: z.string(),
      type: z.enum(['expand', 'polish', 'custom']).optional(),
      content: z.string().optional()
    }))
    .mutation(async function* ({ input }) {
      const { question, type = 'custom', content } = input
      const agent = await AiModelFactory.WritingAgent(type)
      const result = await agent.stream([
        {
          role: 'user',
          content: question
        },
        {
          role: 'system',
          content: `This is the user's note content: ${content || ''}`
        }
      ]);
      for await (const chunk of result.fullStream) {
        yield chunk
      }
    }),
  autoTag: authProcedure
    .input(z.object({
      content: z.string()
    }))
    .mutation(async function ({ input }) {
      const config = await AiModelFactory.globalConfig();
      const { content } = input
      const tagAgent = await AiModelFactory.TagAgent(config.aiTagsPrompt || undefined);
      const tags = await getAllPathTags();
      const result = await tagAgent.generate(
        `Existing tags list: [${tags.join(', ')}]\nNote content: ${content}\nPlease suggest appropriate tags for this content. Include full hierarchical paths for tags like #Parent/Child instead of just #Child.`
      )
      return result?.text?.trim().split(',').map(tag => tag.trim()).filter(Boolean) ?? []
    }),
  autoEmoji: authProcedure
    .input(z.object({
      content: z.string()
    }))
    .mutation(async function ({ input }) {
      const { content } = input
      const agent = await AiModelFactory.EmojiAgent()
      const result = await agent.generate("Please select and suggest appropriate emojis for the above content" + content)
      console.log(result.text)
      return result?.text?.trim().split(',').map(tag => tag.trim()).filter(Boolean) ?? [];
    }),
  AIComment: authProcedure
    .input(z.object({
      content: z.string(),
      noteId: z.number()
    }))
    .mutation(async function ({ input }) {
      return await AiService.AIComment(input)
    }),

  rebuildEmbeddingStart: authProcedure
    .input(z.object({
      force: z.boolean().optional(),
      incremental: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      await RebuildEmbeddingJob.ForceRebuild(input.force ?? true, input.incremental ?? false);
      return { success: true };
    }),

  rebuildEmbeddingResume: authProcedure
    .mutation(async () => {
      await RebuildEmbeddingJob.ResumeRebuild();
      return { success: true };
    }),

  rebuildEmbeddingRetryFailed: authProcedure
    .mutation(async () => {
      await RebuildEmbeddingJob.RetryFailedNotes();
      return { success: true };
    }),

  rebuildEmbeddingStop: authProcedure
    .mutation(async () => {
      await RebuildEmbeddingJob.StopRebuild();
      return { success: true };
    }),

  rebuildEmbeddingProgress: authProcedure
    .query(async () => {
      const progress = await RebuildEmbeddingJob.GetProgress();
      return progress || {
        current: 0,
        total: 0,
        percentage: 0,
        isRunning: false,
        results: [],
        lastUpdate: new Date().toISOString()
      };
    }),

  testConnect: authProcedure
    .input(z.object({
      providerId: z.number(),
      modelKey: z.string(),
      capabilities: z.object({
        inference: z.boolean().optional(),
        tools: z.boolean().optional(),
        image: z.boolean().optional(),
        imageGeneration: z.boolean().optional(),
        video: z.boolean().optional(),
        audio: z.boolean().optional(),
        embedding: z.boolean().optional(),
        rerank: z.boolean().optional()
      })
    }))
    .mutation(async ({ input }) => {
      try {
        const { providerId, modelKey, capabilities } = input;

        // Get provider information
        const provider = await prisma.aiProviders.findUnique({
          where: { id: providerId }
        });

        if (!provider) {
          throw new Error('Provider not found');
        }

        // Create temporary model configuration for testing
        const tempModelConfig = {
          provider: provider.provider,
          baseURL: provider.baseURL,
          apiKey: provider.apiKey,
          config: provider.config,
          modelKey,
          capabilities
        };

        // Test based on model capabilities
        let testResults: any = {};

        // Test inference capability (chat)
        if (capabilities.inference) {
          try {
            const { LLMProvider } = await import('@server/aiServer/providers');
            const llmProvider = new LLMProvider();
            const languageModel = await llmProvider.getLanguageModel({
              provider: provider.provider,
              apiKey: provider.apiKey,
              baseURL: provider.baseURL,
              modelKey,
              apiVersion: (provider.config as any)?.apiVersion
            });

            // Test simple generation
            const { generateText } = await import('ai');
            const result = await generateText({
              model: languageModel,
              prompt: 'Say "Hello" to test connection'
            });
            testResults.inference = { success: true, response: result.text };
          } catch (error) {
            testResults.inference = { success: false, error: error.message };
          }
        }

        // Test embedding capability
        if (capabilities.embedding) {
          try {
            const { EmbeddingProvider } = await import('@server/aiServer/providers');
            const embeddingProvider = new EmbeddingProvider();
            const embeddingModel = await embeddingProvider.getEmbeddingModel({
              provider: provider.provider,
              apiKey: provider.apiKey,
              baseURL: provider.baseURL,
              modelKey,
              apiVersion: (provider.config as any)?.apiVersion
            });

            const { embed } = await import('ai');
            const result = await embed({
              model: embeddingModel as any,
              value: 'test embedding'
            });
            testResults.embedding = { success: true, dimensions: result.embedding?.length || 0 };
          } catch (error) {
            testResults.embedding = { success: false, error: error.message };
          }
        }

        // Test audio capability (speech recognition)
        if (capabilities.audio) {
          throw new Error("audio cannot test")
        }

        const overallSuccess = Object.values(testResults).some((result: any) => result.success);

        return {
          success: overallSuccess,
          capabilities: testResults,
          provider: provider.title,
          model: modelKey
        };
      } catch (error) {
        console.error("Connection test failed:", error);
        throw new Error(`Connection test failed: ${error?.message || "Unknown error"}`);
      }
    }),

  getAllProviders: authProcedure
    .query(async () => {
      return await AiModelFactory.getAllAiProviders();
    }),

  createProvider: authProcedure
    .input(z.object({
      title: z.string(),
      provider: z.string(),
      baseURL: z.string().optional(),
      apiKey: z.string().optional(),
      config: z.any().optional(),
      sortOrder: z.number().default(0)
    }))
    .mutation(async ({ ctx, input }) => {
      const created = await prisma.aiProviders.create({
        data: input,
        include: { models: true }
      });
      // Auto-populate models when a key is present so the user sees the
      // catalogue immediately. Best-effort: a wrong key shouldn't block the
      // provider being saved.
      if (input.apiKey || input.provider.toLowerCase() === 'ollama') {
        try {
          await userCaller(ctx).ai.fetchProviderModels({ providerId: created.id });
        } catch (err) {
          console.warn('[ai.createProvider] auto-fetch models failed', err);
        }
      }
      return await prisma.aiProviders.findUnique({
        where: { id: created.id },
        include: { models: true },
      });
    }),

  updateProvider: authProcedure
    .input(z.object({
      id: z.number(),
      title: z.string().optional(),
      provider: z.string().optional(),
      baseURL: z.string().optional(),
      apiKey: z.string().optional(),
      config: z.any().optional(),
      sortOrder: z.number().optional()
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const updated = await prisma.aiProviders.update({
        where: { id },
        data,
        include: { models: true }
      });
      // Re-fetch the catalogue whenever the key or base URL changes — those
      // are the only inputs that affect what the provider returns.
      if (data.apiKey !== undefined || data.baseURL !== undefined) {
        try {
          await userCaller(ctx).ai.fetchProviderModels({ providerId: id });
        } catch (err) {
          console.warn('[ai.updateProvider] auto-fetch models failed', err);
        }
      }
      return await prisma.aiProviders.findUnique({
        where: { id },
        include: { models: true },
      });
    }),

  deleteProvider: authProcedure
    .input(z.object({
      id: z.number()
    }))
    .mutation(async ({ input }) => {
      return await prisma.aiProviders.delete({
        where: { id: input.id }
      });
    }),

  getAllModels: authProcedure
    .query(async () => {
      return await prisma.aiModels.findMany({
        include: { provider: true },
        orderBy: [{ provider: { sortOrder: 'asc' } }, { sortOrder: 'asc' }]
      });
    }),

  getModelsByProvider: authProcedure
    .input(z.object({
      providerId: z.number()
    }))
    .query(async ({ input }) => {
      return await prisma.aiModels.findMany({
        where: { providerId: input.providerId },
        include: { provider: true },
        orderBy: { sortOrder: 'asc' }
      });
    }),

  getModelsByCapability: authProcedure
    .input(z.object({
      capability: z.string()
    }))
    .query(async ({ input }) => {
      return await AiModelFactory.getAiModelsByCapability(input.capability);
    }),

  createModel: authProcedure
    .input(z.object({
      providerId: z.number(),
      title: z.string(),
      modelKey: z.string(),
      capabilities: z.object({
        inference: z.boolean().default(true),
        tools: z.boolean().default(false),
        image: z.boolean().default(false),
        imageGeneration: z.boolean().default(false),
        video: z.boolean().default(false),
        audio: z.boolean().default(false),
        embedding: z.boolean().default(false),
        rerank: z.boolean().default(false)
      }),
      config: z.any().optional(),
      sortOrder: z.number().default(0)
    }))
    .mutation(async ({ input }) => {
      return await prisma.aiModels.create({
        data: input,
        include: { provider: true }
      });
    }),

  updateModel: authProcedure
    .input(z.object({
      id: z.number(),
      title: z.string().optional(),
      modelKey: z.string().optional(),
      capabilities: z.object({
        inference: z.boolean().optional(),
        tools: z.boolean().optional(),
        image: z.boolean().optional(),
        imageGeneration: z.boolean().optional(),
        video: z.boolean().optional(),
        audio: z.boolean().optional(),
        embedding: z.boolean().optional(),
        rerank: z.boolean().optional()
      }).optional(),
      config: z.any().optional(),
      sortOrder: z.number().optional()
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return await prisma.aiModels.update({
        where: { id },
        data,
        include: { provider: true }
      });
    }),

  deleteModel: authProcedure
    .input(z.object({
      id: z.number()
    }))
    .mutation(async ({ input }) => {
      return await prisma.aiModels.delete({
        where: { id: input.id }
      });
    }),


  createModelsFromProvider: authProcedure
    .input(z.object({
      providerId: z.number(),
      models: z.array(z.object({
        id: z.string(),
        name: z.string(),
        capabilities: z.object({
          inference: z.boolean().default(true),
          tools: z.boolean().default(false),
          image: z.boolean().default(false),
          imageGeneration: z.boolean().default(false),
          video: z.boolean().default(false),
          audio: z.boolean().default(false),
          embedding: z.boolean().default(false),
          rerank: z.boolean().default(false)
        })
      }))
    }))
    .mutation(async ({ input }) => {
      const { providerId, models } = input;

      const createdModels: aiModels[] = [];
      for (const model of models) {
        const created = await prisma.aiModels.create({
          data: {
            providerId,
            title: model.name,
            modelKey: model.id,
            capabilities: model.capabilities,
            sortOrder: 0
          },
          include: { provider: true }
        });
        createdModels.push(created);
      }

      return createdModels;
    }),

  batchCreateModelsFromProvider: authProcedure
    .input(z.object({
      providerId: z.number(),
      selectedModels: z.array(z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().optional(),
        capabilities: z.object({
          inference: z.boolean().optional(),
          tools: z.boolean().optional(),
          image: z.boolean().optional(),
          imageGeneration: z.boolean().optional(),
          video: z.boolean().optional(),
          audio: z.boolean().optional(),
          embedding: z.boolean().optional(),
          rerank: z.boolean().optional()
        }).optional()
      }))
    }))
    .mutation(async ({ input }) => {
      const { providerId, selectedModels } = input;

      const createdModels: aiModels[] = [];
      for (const model of selectedModels) {
        const created = await prisma.aiModels.create({
          data: {
            providerId,
            title: model.name,
            modelKey: model.id,
            capabilities: model.capabilities || {
              inference: true,
              tools: false,
              image: false,
              imageGeneration: false,
              video: false,
              audio: false,
              embedding: false,
              rerank: false
            },
            sortOrder: 0
          },
          include: { provider: true }
        });
        createdModels.push(created);
      }

      return createdModels;
    }),

  fetchProviderModels: authProcedure
    .input(z.object({
      providerId: z.number()
    }))
    .mutation(async ({ input }) => {
      const { providerId } = input;

      const provider = await prisma.aiProviders.findUnique({
        where: { id: providerId }
      });

      if (!provider) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Provider not found'
        });
      }

      const proxiedFetch = await fetchWithProxy();
      let modelList: any[] = [];

      try {
        switch (provider.provider.toLowerCase()) {
          case 'ollama': {
            const endpoint = provider.baseURL || 'http://127.0.0.1:11434';
            const response = await proxiedFetch(`${endpoint}/api/tags`);
            const data = await response.json() as any;
            modelList = data.models?.map((model: any) => ({
              id: model.name,
              name: model.name,
              description: model.description || '',
              capabilities: inferModelCapabilities(model.name)
            })) || [];
            break;
          }

          case 'openai': {
            const endpoint = provider.baseURL || 'https://api.openai.com/v1';
            const response = await proxiedFetch(`${endpoint}/models`, {
              headers: { 'Authorization': `Bearer ${provider.apiKey}` }
            });
            const data = await response.json() as any;
            modelList = data.data?.map((model: any) => ({
              id: model.id,
              name: model.id,
              description: '',
              capabilities: inferModelCapabilities(model.id)
            })) || [];
            break;
          }

          case 'anthropic': {
            // Anthropic added /v1/models in late 2024. Returns the up-to-date
            // model catalogue so new releases (Sonnet 4.x, Opus 4.x, Haiku 4.x)
            // appear automatically without code edits.
            const endpoint = provider.baseURL || 'https://api.anthropic.com/v1';
            const response = await proxiedFetch(`${endpoint}/models?limit=1000`, {
              headers: {
                'x-api-key': provider.apiKey || '',
                'anthropic-version': '2023-06-01',
              },
            });
            const data = await response.json() as any;
            modelList = data.data?.map((model: any) => ({
              id: model.id,
              name: model.display_name || model.id,
              description: '',
              capabilities: inferModelCapabilities(model.id),
            })) || [];
            break;
          }

          case 'voyageai': {
            // Static list - VoyageAI doesn't provide a list models API
            modelList = [
              { id: 'voyage-3', name: 'voyage-3', capabilities: inferModelCapabilities('voyage-3') },
              { id: 'voyage-3-lite', name: 'voyage-3-lite', capabilities: inferModelCapabilities('voyage-3-lite') },
              { id: 'voyage-finance-2', name: 'voyage-finance-2', capabilities: inferModelCapabilities('voyage-finance-2') },
              { id: 'voyage-multilingual-2', name: 'voyage-multilingual-2', capabilities: inferModelCapabilities('voyage-multilingual-2') },
              { id: 'voyage-law-2', name: 'voyage-law-2', capabilities: inferModelCapabilities('voyage-law-2') },
              { id: 'voyage-code-2', name: 'voyage-code-2', capabilities: inferModelCapabilities('voyage-code-2') },
              { id: 'voyage-large-2-instruct', name: 'voyage-large-2-instruct', capabilities: inferModelCapabilities('voyage-large-2-instruct') },
              { id: 'voyage-large-2', name: 'voyage-large-2', capabilities: inferModelCapabilities('voyage-large-2') }
            ];
            break;
          }

          case 'google': {
            const endpoint = provider.baseURL || 'https://generativelanguage.googleapis.com/v1beta';
            const response = await proxiedFetch(`${endpoint}/models?key=${provider.apiKey}`);
            const data = await response.json() as any;
            modelList = data.models?.map((model: any) => ({
              id: model.name.replace('models/', ''),
              name: model.displayName || model.name.replace('models/', ''),
              description: model.description || '',
              capabilities: inferModelCapabilities(model.name)
            })) || [];
            break;
          }

          case 'azure': {
            const endpoint = provider.baseURL;
            const response = await proxiedFetch(`${endpoint}/openai/models?api-version=2024-02-01`, {
              headers: { 'api-key': provider.apiKey || '' }
            });
            const data = await response.json() as any;
            modelList = data.data?.map((model: any) => ({
              id: model.id,
              name: model.id,
              description: '',
              capabilities: inferModelCapabilities(model.id)
            })) || [];
            break;
          }

          case 'minimax': {
            // Static list - MiniMax models with known capabilities
            modelList = [
              { id: 'MiniMax-M2.7', name: 'MiniMax M2.7', capabilities: inferModelCapabilities('MiniMax-M2.7') },
              { id: 'MiniMax-M2.5', name: 'MiniMax M2.5', capabilities: inferModelCapabilities('MiniMax-M2.5') },
              { id: 'MiniMax-M2.5-highspeed', name: 'MiniMax M2.5 Highspeed', capabilities: inferModelCapabilities('MiniMax-M2.5-highspeed') }
            ];
            break;
          }

          default: {
            // Default: use OpenAI-compatible API format
            const endpoint = provider.baseURL;
            if (!endpoint) {
              throw new Error('Base URL is required for custom providers');
            }
            const response = await proxiedFetch(`${endpoint}/models`, {
              headers: { 'Authorization': `Bearer ${provider.apiKey}` }
            });
            const data = await response.json() as any;
            modelList = data.data?.map((model: any) => ({
              id: model.id,
              name: model.id,
              description: '',
              capabilities: inferModelCapabilities(model.id)
            })) || [];
            break;
          }
        }

        // Update provider config with fetched models
        await prisma.aiProviders.update({
          where: { id: providerId },
          data: {
            config: {
              ...(provider.config as any || {}),
              models: modelList
            }
          }
        });

        return modelList;
      } catch (error: any) {
        console.error('Error fetching provider models:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to fetch models: ${error?.message || 'Unknown error'}`
        });
      }
    }),
})

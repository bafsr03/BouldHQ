import { LLMProvider, EmbeddingProvider, AudioProvider, AiUtilities } from './providers';
import { upsertBlinkoTool } from './tools/createBlinko';
import { createCommentTool } from './tools/createComment';
import { LibSQLVector } from "@mastra/libsql";
import dayjs from 'dayjs';
import { EmbeddingModelV1 } from '@ai-sdk/provider';
import { embed } from 'ai';
import { _ } from '@shared/lib/lodash';
import { webSearchTool } from './tools/webSearch';
import { webExtra } from './tools/webExtra';
import { searchBlinkoTool } from './tools/searchBlinko';
import { updateBlinkoTool } from './tools/updateBlinko';
import { deleteBlinkoTool } from './tools/deleteBlinko';
import { createScheduledTaskTool, deleteScheduledTaskTool, listScheduledTasksTool } from './tools/scheduledTask';
import { findResourceTool, listStoresTool, createTaskForManagerTool } from './tools/bouldHqAssistant';
import { createResourceFileTool } from './tools/createResourceFile';
import {
  listFoldersTool,
  deleteResourceTool,
  moveResourceTool,
  renameResourceTool,
} from './tools/resourceManager';
import { getMcpMastraTools, hasMcpServers } from './mcp';
import { slashCommandsForPrompt } from './slashCommands';
import { prisma } from '@server/prisma';
import { getGlobalConfig } from '@server/routerTrpc/config';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { MastraVoice } from '@mastra/core/voice';
import { createClaudeCodeAgent } from './claudeCodeAgent';

export class AiModelFactory {
  static async queryAndDeleteVectorById(targetId: number) {
    const { VectorStore } = await AiModelFactory.GetProvider();
    try {
      const query = `
          WITH target_record AS (
            SELECT vector_id 
            FROM 'blinko'
            WHERE metadata->>'id' = ? 
            LIMIT 1
          )
          DELETE FROM 'blinko'
          WHERE vector_id IN (SELECT vector_id FROM target_record)
          RETURNING *;`;
      //@ts-ignore
      const result = await VectorStore.turso.execute({
        sql: query,
        args: [targetId],
      });

      if (result.rows.length === 0) {
        throw new Error(`id  ${targetId} is not found`);
      }

      return {
        success: true,
        deletedData: result.rows[0],
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'unknown error',
      };
    }
  }

  static async queryVector(query: string, accountId: number, _topK?: number) {
    const { VectorStore, Embeddings } = await AiModelFactory.GetProvider();
    if (!Embeddings) {
      throw new Error("No embeddings model config")
    }
    const config = await AiModelFactory.globalConfig();
    const topK = _topK ?? config.embeddingTopK ?? 3;
    const embeddingMinScore = config.embeddingScore ?? 0.4;
    const { embedding } = await embed({
      value: query,
      model: Embeddings,
    });

    const result = await VectorStore.query({
      indexName: 'blinko',
      queryVector: embedding,
      topK: topK,
    });
    let filteredResults = result.filter(({ score }) => score >= embeddingMinScore);

    const notes =
      (
        await prisma.notes.findMany({
          where: {
            accountId: accountId,
            id: {
              in: _.uniqWith(filteredResults.map((i) => Number(i.metadata?.id))).filter((i) => !!i) as number[],
            },
          },
          include: {
            tags: { include: { tag: true } },
            attachments: {
              orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            },
            references: {
              select: {
                toNoteId: true,
                toNote: {
                  select: {
                    content: true,
                    createdAt: true,
                    updatedAt: true,
                  },
                },
              },
            },
            referencedBy: {
              select: {
                fromNoteId: true,
                fromNote: {
                  select: {
                    content: true,
                    createdAt: true,
                    updatedAt: true,
                  },
                },
              },
            },
            _count: {
              select: {
                comments: true,
                histories: true,
              },
            },
          },
        })
      ).map((i) => {
        return { ...i, score: filteredResults.find((t) => Number(t.metadata?.id) == i.id)?.score ?? 0 };
      }) ?? [];

    let aiContext = notes.map((i) => i.content + '\n') || '';
    return { notes, aiContext: aiContext };
  }

  static async rebuildVectorIndex({ vectorStore, isDelete = false }: { vectorStore: LibSQLVector; isDelete?: boolean }) {
    try {
      if (isDelete) {
        await vectorStore.deleteIndex({ indexName: 'blinko' });
      }
    } catch (error) {
      console.error('delete vector index failed:', error);
    }

    const config = await AiModelFactory.globalConfig();
    const embeddingModel = config.embeddingModelId ? await AiModelFactory.getAiModel(config.embeddingModelId) : null;
    if (!embeddingModel) {
      console.warn('Embedding model not configured, skipping vector index creation');
      return;
    }

    const model = embeddingModel.modelKey.toLowerCase();
    let userConfigDimensions = (embeddingModel.config as any)?.embeddingDimensions || 0;
    let dimensions: number = 0;
    switch (true) {
      case model.includes('text-embedding-3-small'):
        dimensions = 1536;
        break;
      case model.includes('text-embedding-3-large'):
        dimensions = 3072;
        break;
      case model.includes('cohere/embed-english-v3') || model.includes('bge-m3') || model.includes('voyage') || model.includes('bge-large'):
        dimensions = 1024;
        break;
      case model.includes('cohere'):
        dimensions = 4096;
        break;
      case model.includes('voyage-3-lite'):
        dimensions = 512;
        break;
      case model.includes('bge') || model.includes('bert') || model.includes('bce-embedding-base'):
        dimensions = 768;
        break;
      case model.includes('all-minilm'):
        dimensions = 384;
        break;
      case model.includes('mxbai-embed-large'):
        dimensions = 1024;
        break;
      case model.includes('nomic-embed-text'):
        dimensions = 768;
        break;
      case model.includes('bge-large-en'):
        dimensions = 1024;
        break;
      default:
        if (userConfigDimensions == 0 || userConfigDimensions == undefined || !userConfigDimensions) {
          throw new Error('Must set the embedding dimension in ai Settings > Embed Settings > Advanced Settings');
        }
    }
    if (userConfigDimensions != 0 && userConfigDimensions != undefined) {
      dimensions = userConfigDimensions;
    }
    await vectorStore.createIndex({ indexName: 'blinko', dimension: dimensions, metric: 'cosine' });
  }

  static async globalConfig() {
    return await getGlobalConfig({ useAdmin: true });
  }

  static async getAiProvider(id: number) {
    return await prisma.aiProviders.findUnique({
      where: { id },
      include: { models: true }
    });
  }

  static async getAllAiProviders() {
    return await prisma.aiProviders.findMany({
      include: { models: true },
      orderBy: { sortOrder: 'asc' }
    });
  }

  static async getAiModel(id: number) {
    return await prisma.aiModels.findUnique({
      where: { id },
      include: { provider: true }
    });
  }

  static async getAiModelsByCapability(capability: string) {
    return await prisma.aiModels.findMany({
      where: {
        capabilities: {
          path: [capability],
          equals: true
        }
      },
      include: { provider: true },
      orderBy: { sortOrder: 'asc' }
    });
  }


  // Kept for legacy callers. Chat is now served by Claude Code, so a configured
  // main model is no longer required — only embedding/audio/image setups need
  // their respective providers.
  static async ValidConfig() {
    return await AiModelFactory.globalConfig();
  }

  static async GetProvider() {
    const globalConfig = await AiModelFactory.globalConfig();

    const mainModel = globalConfig.mainModelId
      ? await AiModelFactory.getAiModel(globalConfig.mainModelId)
      : null;

    const embeddingModel = globalConfig.embeddingModelId
      ? await AiModelFactory.getAiModel(globalConfig.embeddingModelId)
      : null;

    const audioModel = globalConfig.voiceModelId
      ? await AiModelFactory.getAiModel(globalConfig.voiceModelId)
      : null;

    const imageModel = globalConfig.imageModelId
      ? await AiModelFactory.getAiModel(globalConfig.imageModelId)
      : null;

    // Initialize providers
    const llmProvider = new LLMProvider();
    const embeddingProvider = new EmbeddingProvider();
    const audioProvider = new AudioProvider();

    // Get LLM instance only if a legacy chat model is still configured.
    // Claude Code handles chat now; this is preserved for any non-chat callers
    // that still reference provider.LLM.
    let llm: any = null;
    if (mainModel) {
      const llmConfig = {
        provider: mainModel.provider.provider,
        apiKey: mainModel.provider.apiKey,
        baseURL: mainModel.provider.baseURL,
        modelKey: mainModel.modelKey,
        apiVersion: (mainModel.provider.config as any)?.apiVersion,
      };
      llm = await llmProvider.getLanguageModel(llmConfig);
    }

    // Get Embedding instance (if configured)
    let embeddings: EmbeddingModelV1<string> | null = null;
    if (embeddingModel) {
      const embeddingConfig = {
        provider: embeddingModel.provider.provider,
        apiKey: embeddingModel.provider.apiKey,
        baseURL: embeddingModel.provider.baseURL,
        modelKey: embeddingModel.modelKey,
        apiVersion: (embeddingModel.provider.config as any)?.apiVersion
      };
      embeddings = await embeddingProvider.getEmbeddingModel(embeddingConfig);
    }

    // Get Audio instance (if configured)
    let audio: MastraVoice | null = null;
    if (audioModel) {
      const audioConfig = {
        provider: audioModel.provider.provider,
        apiKey: audioModel.provider.apiKey,
        baseURL: audioModel.provider.baseURL,
        modelKey: audioModel.modelKey,
        apiVersion: (audioModel.provider.config as any)?.apiVersion
      };
      audio = await audioProvider.getAudioModel(audioConfig);
    }

    // Get utilities
    const vectorStore = await AiUtilities.VectorStore();
    const markdownSplitter = AiUtilities.MarkdownSplitter();
    const tokenTextSplitter = AiUtilities.TokenTextSplitter();

    return {
      LLM: llm,
      VectorStore: vectorStore,
      Embeddings: embeddings,
      MarkdownSplitter: markdownSplitter,
      TokenTextSplitter: tokenTextSplitter,
      audioModel: audio,
      // Keep for backward compatibility
      provider: {
        llmProvider,
        embeddingProvider,
        audioProvider
      }
    };
  }
  // BouldHQ assistant — scoped agent for the /ai page. Three jobs:
  //   1. Explain how the BouldHQ app/workflow works.
  //   2. Find a saved resource or note the user can't remember where they put.
  //   3. Open a task (storeRequest) against a specific store for the agent manager.
  // Deliberately narrow tool set — no webSearch, no upsert/delete of notes.
  static async BouldHqAssistantAgent() {
    const instructions =
`Today is ${dayjs().format('YYYY-MM-DD HH:mm:ss')}
You are the BouldHQ Ops Assistant. BouldHQ is an AI-powered ops platform for managing Shopify stores. Roles:
  • founder — sees everything across all teams.
  • manager — runs the agent workspace and triages requests against the team's stores.
  • salesman — onboards new store owners and submits requests on their behalf.

You are speaking with the founder. The assistant is gated to founders only —
you are trusted to take destructive actions on the founder's behalf without
asking for confirmation. Be decisive. Act, then summarize what you did.

You have tools available. ALWAYS use them when applicable:

READ:
  • bouldhq-find-resource          — search Resources by name/folder
  • bouldhq-list-folders           — list every folder + its file count (use this BEFORE deleting / moving)
  • bouldhq-list-stores            — list the team's stores (returns tagId + name)
  • search-blinko-tool             — semantic search across notes

WRITE:
  • bouldhq-create-resource-file   — save a new HTML / Markdown / text file into Resources
  • bouldhq-create-task-for-manager — open a task / request for a store

MODIFY / DELETE (destructive — act without asking):
  • bouldhq-delete-resource        — delete a file or a whole folder (cascades). Pass {attachmentId} OR {folderPath}.
  • bouldhq-move-resource          — move files into a different folder. Pass {attachmentIds, targetFolderPath}.
  • bouldhq-rename-resource        — rename a file or rewrite a folder path.

Operating rules:
  • When tools exist for what the user wants, USE THEM. Never tell the founder to "do it manually" if there's a tool.
  • For cleanup tasks (de-duplicating folders, removing unused stores' assets, etc.): use bouldhq-list-folders + bouldhq-list-stores to plan, then execute with delete/move/rename. Don't ask for confirmation — act, then summarize what you did and what's left.
  • When opening a task, pass the user's wording verbatim into the body. Do not paraphrase.
  • Resolve a store name to its tagId via bouldhq-list-stores before calling tools that need it.
  • When generating documents, save them to Resources with bouldhq-create-resource-file instead of dumping the whole document into chat. Reply with the saved path + a short summary.
  • You can answer general questions and generate any content the user asks for.
  • Always respond in the user's language. Keep responses tight.

SLASH COMMANDS the user may type (already expanded by the server before you see the message — but here's what they mean):
${slashCommandsForPrompt()}

HTML REPORT TEMPLATE — when /report fires, produce a self-contained HTML document using this skeleton. Brand variables at the top so the team can override per store. Inline CSS only. Do not link external stylesheets.

<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>{{STORE}} — Weekly Report — {{DATE}}</title>
<style>
  :root {
    --brand-primary: #111;
    --brand-accent: #e85d2c;   /* override per store later */
    --bg: #fafafa;
    --fg: #111;
    --muted: #666;
    --border: #e5e5e5;
    --radius: 12px;
    --maxw: 880px;
    font-family: -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif;
  }
  body { margin: 0; background: var(--bg); color: var(--fg); }
  .wrap { max-width: var(--maxw); margin: 0 auto; padding: 48px 24px; }
  header { display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--border); padding-bottom:24px; margin-bottom:32px; }
  header .brand { font-weight: 700; letter-spacing:-0.02em; font-size:24px; color:var(--brand-primary); }
  header .meta { color: var(--muted); font-size: 13px; text-align:right; }
  h1 { font-size: 32px; letter-spacing:-0.02em; margin: 0 0 8px; }
  h2 { font-size: 18px; margin: 36px 0 12px; color: var(--brand-primary); }
  section { background:#fff; border:1px solid var(--border); border-radius:var(--radius); padding:20px 24px; margin-bottom:16px; }
  .pill { display:inline-block; padding:2px 10px; border-radius:999px; background:var(--brand-accent); color:#fff; font-size:12px; font-weight:600; }
  ul { padding-left: 20px; }
  li { margin: 6px 0; line-height:1.5; }
  .metric { display:inline-block; min-width:160px; margin:8px 16px 8px 0; }
  .metric .label { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:0.04em; }
  .metric .value { font-size:26px; font-weight:700; letter-spacing:-0.01em; }
  footer { color: var(--muted); font-size:12px; text-align:center; margin-top:32px; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="brand">BouldHQ</div>
      <div class="meta">{{STORE}} · Week of {{DATE}}</div>
    </header>

    <h1>{{STORE}} — Weekly Report</h1>
    <span class="pill">Status: {{STATUS}}</span>

    <section>
      <h2>Executive Summary</h2>
      <p>{{EXEC_SUMMARY}}</p>
    </section>

    <section>
      <h2>Wins This Week</h2>
      <ul>{{WINS_LIST}}</ul>
    </section>

    <section>
      <h2>Issues Fixed</h2>
      <ul>{{ISSUES_LIST}}</ul>
    </section>

    <section>
      <h2>Revenue Opportunities</h2>
      <ul>{{OPPORTUNITIES_LIST}}</ul>
    </section>

    <section>
      <h2>Metrics</h2>
      {{METRICS_BLOCK}}
    </section>

    <section>
      <h2>Next Week Roadmap</h2>
      <ul>{{ROADMAP_LIST}}</ul>
    </section>

    <footer>Generated by BouldHQ on {{TIMESTAMP}}</footer>
  </div>
</body>
</html>

Replace every {{TOKEN}} with real content. If real Shopify/analytics data isn't available, write a clearly-marked placeholder like "<i>Awaiting Shopify analytics integration</i>" — never invent numbers. Keep bullet lists to 3–6 items each.`;

    return createClaudeCodeAgent({
      name: 'BouldHQ Assistant',
      instructions,
      tools: {
        findResourceTool,
        listStoresTool,
        listFoldersTool,
        createTaskForManagerTool,
        createResourceFileTool,
        deleteResourceTool,
        moveResourceTool,
        renameResourceTool,
        searchBlinkoTool,
      },
    });
  }

  static async BaseChatAgent({ withTools = true, withOnlineSearch = false, withMcpTools = true }: { withTools?: boolean; withOnlineSearch?: boolean; withMcpTools?: boolean }) {
    let tools: Record<string, any> = {};
    if (withTools) {
      tools = {
        upsertBlinkoTool,
        searchBlinkoTool,
        updateBlinkoTool,
        deleteBlinkoTool,
        webExtra,
        webSearchTool,
        createCommentTool,
        createScheduledTaskTool,
        deleteScheduledTaskTool,
        listScheduledTasksTool,
      };
    }
    if (withOnlineSearch) {
      tools.webSearchTool = webSearchTool;
    }

    // Load MCP tools if enabled
    if (withMcpTools && withTools) {
      try {
        const hasMcp = await hasMcpServers();
        if (hasMcp) {
          const mcpTools = await getMcpMastraTools();
          if (Object.keys(mcpTools).length > 0) {
            tools = { ...tools, ...mcpTools };
            console.log(`[AI] Loaded ${Object.keys(mcpTools).length} MCP tools`);
          }
        }
      } catch (error) {
        console.error('[AI] Failed to load MCP tools:', error);
        // Continue without MCP tools - don't break the agent
      }
    }

    const globalConfig = await AiModelFactory.globalConfig();
    const defaultInstructions =
      `Today is ${dayjs().format('YYYY-MM-DD HH:mm:ss')}\n` +
      'You are a versatile AI assistant who can:\n' +
      '1. Answer questions and explain concepts\n' +
      '2. Provide suggestions and analysis\n' +
      '3. Help with planning and organizing ideas\n' +
      '4. Assist with content creation and editing\n' +
      '5. Perform basic calculations and reasoning\n\n' +
      "6. When using 'web-search-tool' to return results, use the markdown link format to mark the origin of the page" +
      "7. When using 'search-blinko-tool', The entire content of the note should not be returned unless specifically specified by the user " +
      "Always respond in the user's language.\n" +
      'Maintain a friendly and professional conversational tone.';

    const instructions = globalConfig.globalPrompt
      ? `Today is ${dayjs().format('YYYY-MM-DD HH:mm:ss')}\n${globalConfig.globalPrompt}`
      : defaultInstructions;

    return createClaudeCodeAgent({
      name: 'Blinko Chat Agent',
      instructions,
      tools,
    });
  }

  static #createAgentFactory(
    name: string,
    systemPrompt: string | ((customPrompt?: string) => string),
    _loggerName: string,
    options?: {
      tools?: Record<string, any>;
      isWritingAgent?: boolean;
    },
  ) {
    return async (type?: 'expand' | 'polish' | 'custom' | string) => {
      const finalPrompt = typeof systemPrompt === 'function' ? systemPrompt(type!) : systemPrompt;
      return createClaudeCodeAgent({
        name: options?.isWritingAgent ? `${name} - ${type}` : name,
        instructions: finalPrompt,
        tools: options?.tools,
      });
    };
  }

  static TagAgent = AiModelFactory.#createAgentFactory(
    'Blinko Tagging Agent',
    (customPrompt?: string) => {
      console.log(customPrompt, 'customPrompt');
      if (customPrompt) {
        return customPrompt;
      }
      return `You are a precise label classification expert, and you will generate precisely matched content labels based on the content. Rules:
      1. **Core Selection Principle**: Select 5 to 8 tags from the existing tag list that are most relevant to the content theme. Carefully compare the key information, technical types, application scenarios, and other elements of the content to ensure that the selected tags accurately reflect the main idea of the content.
      2. **Language Matching Strategy**: If the language of the existing tags does not match the language of the content, give priority to using the language of the existing tags to maintain the consistency of the language style of the tag system.
      3. **Tag Structure Requirements**: When using existing tags, it is necessary to construct a parent-child hierarchical structure. For example, place programming language tags under parent tags such as #Code or #Programming, like #Code/JavaScript, #Programming/Python. When adding new tags, try to classify them under appropriate existing parent tags as well.
      4. **New Tag Generation Rules**: If there are no tags in the existing list that match the content, create new tags based on the key technologies, business fields, functional features, etc. of the content. The language of the new tags should be consistent with that of the content.
      5. **Response Format Specification**: Only return tags separated by commas. There should be no spaces between tags, and no formatting or code blocks should be used. Each tag should start with #, such as #JavaScript.
      6. **Example**: For JavaScript content related to web development, a reference response could be #Programming/Languages, #Web/Development, #Code/JavaScript, #Front-End Development/Frameworks (if applicable), #Browser Compatibility. It is strictly prohibited to respond in formats such as code blocks, JSON, or Markdown. Just provide the tags directly. 
          `;
    },
    'BlinkoTag',
  );

  static EmojiAgent = AiModelFactory.#createAgentFactory(
    'Blinko Emoji Agent',
    `You are an emoji recommendation expert. Rules:
     1. Analyze content theme and emotion
     2. Return 4-10 comma-separated emojis
     3. Use '💻,🔧' for tech content, '😊,🎉' for emotional content
     4. Must be separated by comma like '💻,🔧'`,
    'BlinkoEmoji',
  );

  static RelatedNotesAgent = AiModelFactory.#createAgentFactory(
    'Blinko Related Notes Agent',
    `You are a keyword extraction expert. Your task is to extract the most representative keywords from the provided note content.

    Rules:
    1. Analyze note content to identify core themes, concepts, and key information
    2. Extract 5-8 keywords or phrases that accurately summarize the content
    3. Ensure the extracted keywords are specific and can be used to find related notes
    4. Sort the extracted keywords by importance from high to low
    5. Return a comma-separated list of keywords without any additional formatting or explanation
    6. Keywords should accurately express the content theme, not too broad or specific
    7. If the note content includes professional terms or technical content, please ensure that the keywords include these terms

    Example output:
    machine learning, neural network, deep learning, TensorFlow, image recognition`,
    'BlinkoRelatedNotes',
  );

  static CommentAgent = AiModelFactory.#createAgentFactory(
    'Blinko Comment Agent',
    `You are Blinko Comment Assistant. Guidelines:
     1. Use Markdown formatting
     2. Include 1-2 relevant emojis
     3. Maintain professional tone
     4. Keep responses concise (50-150 words)
     5. Match user's language`,
    'BlinkoComment',
  );

  static SummarizeAgent = AiModelFactory.#createAgentFactory(
    'Blinko Summary Agent',
    `You are a conversation title summarizer. Rules:
      1. Summarize the content 
      2. Return the title only
      3. Generate titles based on the user's language
      4. Do not return any punctuation marks in the result
      5. Keep it short and concise`,
    'BlinkoSummary',
  );

  static WritingAgent = AiModelFactory.#createAgentFactory(
    'Blinko Writing Agent',
    (type) => {
      const prompts = {
        expand: `# Text Expansion Expert
          ## Original Content
          {content}

          ## Requirements
          1. Use same language as input
          2. Add details/examples without introducing new concepts
          3. Maintain original structure and style
          4. Use Markdown formatting
          5. Output format with markdown
          6. Do not add explanation`,

        polish: `# Text Refinement Specialist
          ## Input Text
          {content}

          ## Guidelines
          1. Optimize sentence flow and vocabulary
          2. Preserve core meaning
          3. Apply technical writing standards
          4. Use Markdown formatting
          5. Output format with markdown`,

        custom: `# Multi-Purpose Writing Assistant
            ## User Request
            {content}

            ## Requirements
            1. Create content as needed
            2. Follow industry-standard documentation
            3. Use Markdown formatting
            4. Output format with markdown`,
      };
      return prompts[type as 'expand' | 'polish' | 'custom'] || prompts['custom'];
    },
    'BlinkoWriting',
    { isWritingAgent: true },
  );

  static TestConnectAgent = AiModelFactory.#createAgentFactory('Blinko Test Connect Agent', `Test the api is working,return 1 words`, 'BlinkoTestConnect');

  // BouldHQ — classifies a salesman-submitted store request as automatable vs
  // needs-human, with a short reasoning string. Strict JSON output, no prose.
  static TriageAgent = AiModelFactory.#createAgentFactory(
    'BouldHQ Triage Agent',
    `You are a triage agent for BouldHQ, a Shopify store ops platform.
You receive a raw message from a salesman that contains what a store owner is asking for.
Your job is to decide whether the request is automatable by our agents or needs a human operator.

AUTOMATABLE PLAYBOOKS (canAutomate=true, category=one of these slugs):
  - shopify_collab_invite   — sending or accepting a Shopify collaborator invite
  - theme_setting_tweak     — color, font, or layout tweak via theme settings JSON
  - product_metadata_update — update title, description, SEO tags, or pricing on products
  - inventory_sync_check    — verify or trigger inventory sync between sources
  - shipping_rate_update    — adjust shipping zones, rates, or carrier settings
  - app_install             — install or configure a Shopify app
  - dns_record_check        — verify DNS records / domain config
  - email_template_edit     — update transactional email copy

NEEDS HUMAN (canAutomate=false, category=human_required):
  - 3D modeling, custom illustration, photography
  - Bespoke theme code changes (Liquid templating beyond simple settings)
  - Strategic / advisory discussion
  - Legal, accounting, tax
  - Anything ambiguous, multi-step, or that requires the store owner's judgement
  - Anything you cannot confidently map to an AUTOMATABLE PLAYBOOK above

OUTPUT FORMAT — RESPOND WITH JSON ONLY. NO MARKDOWN, NO CODE FENCES, NO PROSE BEFORE OR AFTER.
{
  "canAutomate": boolean,
  "category": "<one of the slugs above, or 'human_required'>",
  "reasoning": "<1-2 sentences, plain English, no jargon>",
  "suggestedAction": "<concrete next step. For automatable: name the playbook + key parameters. For human: describe what the manager should do>"
}`,
    'BouldHQTriage',
  );

  static ImageEmbeddingAgent = AiModelFactory.#createAgentFactory(
    'Blinko Image Embedding Agent',
    `You are a vision assistant. When provided an image, you must:
1) Describe the image in detail (objects, scenes, layout, style, colors).
2) Extract and return all visible text in the image (OCR) accurately.
If the underlying model does not support image inputs, respond exactly with: not support image`,
    'BlinkoImageEmbedding',
  );

  static async readImage(
    imagePath: string,
    options?: { maxEdge?: number; quality?: number; toJPEG?: boolean; background?: string },
  ): Promise<{ dataUrl: string; mime: string }> {
    const { maxEdge = 1024, quality = 70, toJPEG = true, background = '#ffffff' } = options || {};
    try {
      let pipeline = sharp(imagePath).rotate();
      pipeline = pipeline.resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true });
      if (toJPEG) {
        // Remove alpha channel when converting to JPEG
        pipeline = pipeline.flatten({ background }).jpeg({ quality, mozjpeg: true });
      }
      const buffer = await pipeline.toBuffer();
      const mime = toJPEG ? 'image/jpeg' : path.extname(imagePath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
      return { dataUrl: `data:${mime};base64,${buffer.toString('base64')}`, mime };
    } catch (err) {
      // Fallback to original file if compression fails
      const fallbackMime = path.extname(imagePath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
      return { dataUrl: `data:${fallbackMime};base64,${fs.readFileSync(imagePath, 'base64')}`, mime: fallbackMime };
    }
  }

  static async describeImage(imagePath: string): Promise<string> {
    try {
      const agent = await AiModelFactory.ImageEmbeddingAgent();
      console.log(imagePath, 'imagePath');
      const { dataUrl, mime } = await AiModelFactory.readImage(imagePath);
      const response = await agent.generate(
        [
          {
            role: 'user',
            content: [
              { type: 'image', image: dataUrl, mimeType: mime },
              {
                type: 'text',
                text: 'Describe the image in detail, and extract all the text in the image.',
              },
            ],
          },
        ],
        { temperature: 0.3 },
      );
      console.log(response.text?.trim(), 'response.text?.trim()');
      return response.text?.trim() || '';
    } catch (error) {
      console.log(error, 'error');
      // Fallback when model/provider does not support images or any error occurs
      return 'not support image';
    }
  }

  // static async GetAudioLoader(audioPath: string) {
  //   const globalConfig = await AiModelFactory.ValidConfig()
  //   if (globalConfig.aiModelProvider == 'OpenAI') {
  //     const provider = new OpenAIModelProvider({ globalConfig })
  //     return provider.AudioLoader(audioPath)
  //   } else {
  //     throw new Error('not support other loader')
  //   }
  // }
}

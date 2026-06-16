// claudeCodeAgent.ts — single seam between Blinko and the Claude Code subscription.
//
// Auth: owner runs `claude setup-token` once and sets CLAUDE_CODE_OAUTH_TOKEN
// on the server. Every team member's AI request goes through this token.
// When the team moves to Claude Enterprise, only `getClaudeCodeAuth()` changes.
//
// The factory returns objects that match the Mastra Agent surface
// (`.generate()` / `.stream()`) so the existing call sites in aiModelFactory
// and ai.ts don't need to change shape.

import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';

export type ClaudeCodeMessage =
  | { role: 'user' | 'assistant' | 'system'; content: string }
  | { role: 'user' | 'assistant'; content: Array<TextBlock | ImageBlock> };

type TextBlock = { type: 'text'; text: string };
type ImageBlock = { type: 'image'; image: string; mimeType?: string };

type MastraToolLike = {
  id: string;
  description?: string;
  inputSchema: any;
  execute: (args: { context: any; runtimeContext?: any }) => Promise<any>;
};

type RuntimeContextLike = {
  get?: (key: string) => any;
  set?: (key: string, value: any) => void;
};

export function isClaudeCodeConfigured(): boolean {
  return !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
}

export function getClaudeCodeAuth(_ctx?: { teamId?: number }): string {
  const t = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!t) {
    throw new Error(
      'Claude Code is not configured on this server. ' +
        'The administrator must run `claude setup-token` and set CLAUDE_CODE_OAUTH_TOKEN.',
    );
  }
  return t;
}

function sanitizeToolName(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function extractText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b?.type === 'text' ? b.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function hasImageContent(messages: ClaudeCodeMessage[]): boolean {
  return messages.some(
    (m) => Array.isArray((m as any).content) && (m as any).content.some((b: any) => b?.type === 'image'),
  );
}

function dataUrlToBase64(dataUrl: string): { mediaType: string; data: string } {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) return { mediaType: 'image/jpeg', data: dataUrl };
  return { mediaType: m[1], data: m[2] };
}

// Build a single text prompt that encodes a multi-turn text conversation.
// Anthropic models read this format reliably; keeps the seam simple — no need
// to use SDK streaming-input mode unless images are present.
function buildTextPrompt(messages: ClaudeCodeMessage[]): {
  systemExtras: string[];
  promptText: string;
} {
  const systemExtras: string[] = [];
  const turns: string[] = [];
  let lastUserSeen = false;

  for (const m of messages) {
    const text = extractText((m as any).content);
    if (!text) continue;
    if (m.role === 'system') {
      systemExtras.push(text);
    } else if (m.role === 'user') {
      turns.push(`User: ${text}`);
      lastUserSeen = true;
    } else if (m.role === 'assistant') {
      turns.push(`Assistant: ${text}`);
    }
  }

  if (!lastUserSeen) turns.push('User: ');
  return { systemExtras, promptText: turns.join('\n\n') };
}

// Image conversation: encode as Claude Agent SDK streaming-input messages so
// the image bytes get attached to a real user turn. Only user turns are
// streamed in (assistant history isn't supported in streaming-input mode).
async function* buildImageStream(messages: ClaudeCodeMessage[]): AsyncIterable<any> {
  for (const m of messages) {
    if (m.role !== 'user') continue;
    const content = (m as any).content;
    if (typeof content === 'string') {
      yield {
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: content }] },
      };
      continue;
    }
    if (!Array.isArray(content)) continue;

    const blocks = content.map((b: any) => {
      if (b.type === 'image') {
        const { mediaType, data } = dataUrlToBase64(b.image);
        return {
          type: 'image',
          source: { type: 'base64', media_type: b.mimeType || mediaType, data },
        };
      }
      return { type: 'text', text: b.text };
    });

    yield { type: 'user', message: { role: 'user', content: blocks } };
  }
}

function wrapMastraTool(mastraTool: MastraToolLike, runtimeValues: Record<string, any>) {
  const name = sanitizeToolName(mastraTool.id);
  const shape = mastraTool.inputSchema?.shape ?? {};
  const sdkTool = tool(
    name,
    mastraTool.description || mastraTool.id,
    shape,
    async (args: any) => {
      const runtimeContext: RuntimeContextLike = {
        get: (k) => runtimeValues[k],
        set: (k, v) => {
          runtimeValues[k] = v;
        },
      };
      try {
        const result = await mastraTool.execute({ context: args, runtimeContext });
        return {
          content: [
            { type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) },
          ],
        };
      } catch (e: any) {
        return {
          content: [{ type: 'text', text: `Error: ${e?.message || String(e)}` }],
          isError: true,
        };
      }
    },
  );
  return { name, originalId: mastraTool.id, sdkTool };
}

function pullRuntimeValues(opts?: { runtimeContext?: any }): Record<string, any> {
  const out: Record<string, any> = {};
  const rc = opts?.runtimeContext;
  if (!rc) return out;
  // Mastra RuntimeContext exposes .get(key); we don't know the full key list,
  // so we lazily proxy through. Cache a known key (accountId).
  const accountId = typeof rc.get === 'function' ? rc.get('accountId') : rc.accountId;
  if (accountId !== undefined) out.accountId = accountId;
  return out;
}

export type AgentLike = {
  name: string;
  generate(
    input: string | ClaudeCodeMessage[],
    opts?: { runtimeContext?: any; temperature?: number },
  ): Promise<{ text: string; toolCalls: any[]; toolResults: any[] }>;
  stream(
    input: string | ClaudeCodeMessage[],
    opts?: { runtimeContext?: any; temperature?: number },
  ): Promise<{ fullStream: AsyncIterable<any>; text: Promise<string> }>;
};

export function createClaudeCodeAgent(opts: {
  name: string;
  instructions: string;
  tools?: Record<string, MastraToolLike>;
  model?: string; // optional override, e.g. 'claude-opus-4-7'
}): AgentLike {
  const { name, instructions, tools = {} } = opts;
  const toolList = Object.values(tools);

  function buildQueryOptions(runtimeValues: Record<string, any>) {
    const wrapped = toolList.map((t) => wrapMastraTool(t, runtimeValues));
    // Use the SDK's createSdkMcpServer helper — it returns a real in-process
    // MCP server instance, which is what the SDK expects in mcpServers. A
    // plain { type: 'sdk', tools } object is registered but the tools are
    // never exposed to the model.
    const mcpServers =
      wrapped.length > 0
        ? {
            blinko: createSdkMcpServer({
              name: 'blinko',
              version: '1.0.0',
              tools: wrapped.map((w) => w.sdkTool),
            }),
          }
        : undefined;
    const allowedTools = wrapped.length > 0 ? wrapped.map((w) => `mcp__blinko__${w.name}`) : undefined;
    return {
      mcpServers,
      allowedTools,
      systemPrompt: instructions,
      model: opts.model,
      // Permission mode: tools are allow-listed, no interactive approval needed.
      permissionMode: 'bypassPermissions' as const,
      // Single-shot — no recursive Task tool, no slash commands, no MCP from the
      // user's host (we control the tool set).
      disallowedTools: ['Task'],
    };
  }

  function normalizeInput(input: string | ClaudeCodeMessage[]): ClaudeCodeMessage[] {
    if (typeof input === 'string') return [{ role: 'user', content: input }];
    return input;
  }

  return {
    name,

    async generate(input, opts) {
      // Set auth token for the SDK process call.
      process.env.CLAUDE_CODE_OAUTH_TOKEN = getClaudeCodeAuth();

      const messages = normalizeInput(input);
      const runtimeValues = pullRuntimeValues(opts);
      const qOpts = buildQueryOptions(runtimeValues);

      const hasImages = hasImageContent(messages);
      const prompt: any = hasImages
        ? buildImageStream(messages)
        : (() => {
            const { systemExtras, promptText } = buildTextPrompt(messages);
            // Append system extras (RAG context, per-call system prompts) to the system prompt.
            if (systemExtras.length > 0) {
              qOpts.systemPrompt = `${qOpts.systemPrompt}\n\n${systemExtras.join('\n\n')}`;
            }
            return promptText;
          })();

      const textParts: string[] = [];
      const toolCalls: any[] = [];
      const toolResults: any[] = [];

      for await (const msg of query({ prompt, options: qOpts })) {
        if (msg.type === 'assistant') {
          for (const block of (msg as any).message?.content ?? []) {
            if (block.type === 'text') textParts.push(block.text);
            else if (block.type === 'tool_use') {
              toolCalls.push({
                toolName: (block.name as string).replace(/^mcp__blinko__/, ''),
                args: block.input,
                toolCallId: block.id,
              });
            }
          }
        } else if (msg.type === 'user') {
          for (const block of (msg as any).message?.content ?? []) {
            if (block.type === 'tool_result') {
              toolResults.push({
                toolName: '',
                result: typeof block.content === 'string' ? block.content : block.content,
                toolCallId: block.tool_use_id,
              });
            }
          }
        } else if (msg.type === 'result') {
          if ((msg as any).subtype !== 'success' && (msg as any).is_error) {
            throw new Error((msg as any).result || 'Claude Code returned an error');
          }
          if (!textParts.length && (msg as any).result) {
            textParts.push((msg as any).result);
          }
        }
      }

      return {
        text: textParts.join(''),
        toolCalls,
        toolResults,
      };
    },

    async stream(input, opts) {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = getClaudeCodeAuth();

      const messages = normalizeInput(input);
      const runtimeValues = pullRuntimeValues(opts);
      const qOpts = buildQueryOptions(runtimeValues);

      const hasImages = hasImageContent(messages);
      const prompt: any = hasImages
        ? buildImageStream(messages)
        : (() => {
            const { systemExtras, promptText } = buildTextPrompt(messages);
            if (systemExtras.length > 0) {
              qOpts.systemPrompt = `${qOpts.systemPrompt}\n\n${systemExtras.join('\n\n')}`;
            }
            return promptText;
          })();

      let textResolve!: (v: string) => void;
      const textPromise = new Promise<string>((res) => {
        textResolve = res;
      });

      async function* fullStream() {
        const collected: string[] = [];
        try {
          for await (const msg of query({ prompt, options: qOpts })) {
            if (msg.type === 'assistant') {
              for (const block of (msg as any).message?.content ?? []) {
                if (block.type === 'text') {
                  collected.push(block.text);
                  yield { type: 'text-delta', textDelta: block.text };
                } else if (block.type === 'tool_use') {
                  yield {
                    type: 'tool-call',
                    toolCallId: block.id,
                    toolName: (block.name as string).replace(/^mcp__blinko__/, ''),
                    args: block.input,
                  };
                }
              }
            } else if (msg.type === 'user') {
              for (const block of (msg as any).message?.content ?? []) {
                if (block.type === 'tool_result') {
                  yield {
                    type: 'tool-result',
                    toolCallId: block.tool_use_id,
                    toolName: '',
                    result:
                      typeof block.content === 'string' ? block.content : block.content,
                  };
                }
              }
            } else if (msg.type === 'result') {
              if ((msg as any).is_error) {
                yield { type: 'error', error: (msg as any).result || 'Claude Code error' };
              }
              yield { type: 'finish', finishReason: 'stop' };
            }
          }
        } finally {
          textResolve(collected.join(''));
        }
      }

      return { fullStream: fullStream(), text: textPromise };
    },
  };
}

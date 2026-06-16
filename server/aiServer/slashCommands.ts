// Slash-command registry — single source of truth.
//
// The chat UI is a plain textarea. When the user's message starts with
// /<word>, the server (assistantChat) expands it into a longer instruction
// before passing to the agent. The same registry is what the boot-time
// commands manual is generated from, so /help, the system prompt, the doc,
// and the runtime never drift.

import { prisma } from '@server/prisma';

// Public asset path for the BouldHQ wordmark. Lives in app/public/ so it
// ships with the frontend and is reachable at <origin>/bouldhq-logo.png.
const BOULDHQ_LOGO_PATH = '/bouldhq-logo.png';

function buildAbsoluteUrl(path: string, baseUrl: string): string {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${normalized}`;
}

export type SlashCommandCtx = {
  accountId: number;
  // Absolute URL of the server (e.g. https://hq.bouldhq.com). The expander
  // uses this to build absolute logo URLs so the report HTML works whether
  // the file is previewed in-app, downloaded, or shared.
  baseUrl: string;
};

export type SlashCommand = {
  name: string;
  aliases?: string[];
  summary: string;
  usage: string;
  example?: string;
  expand: (rest: string, ctx: SlashCommandCtx) => Promise<string> | string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'report',
    summary: 'Generate a weekly HTML report for a store and save it to Resources.',
    usage: '/report <store>',
    example: '/report joon',
    expand: async (rest, ctx) => {
      const store = rest.trim();
      const today = new Date().toISOString().slice(0, 10);
      if (!store) {
        return 'The user typed `/report` without a store name. Ask them which store you should report on, then list the available stores via bouldhq-list-stores.';
      }

      // Resolve the store and its profile (logo + url) so we can hand the
      // model exact URLs to drop into the report HTML.
      const tag = await prisma.tag.findFirst({
        where: {
          name: { equals: store, mode: 'insensitive' },
          parent: 0,
          archivedAt: null,
        },
        select: { id: true, name: true },
      });
      let storeLogoUrl = '';
      let storeUrl = '';
      let canonicalName = store;
      if (tag) {
        canonicalName = tag.name;
        const profile = await prisma.storeProfile.findUnique({
          where: { tagId: tag.id },
          select: { logoPath: true, storeUrl: true },
        });
        if (profile?.logoPath) storeLogoUrl = buildAbsoluteUrl(profile.logoPath, ctx.baseUrl);
        if (profile?.storeUrl) storeUrl = profile.storeUrl;
      }
      const bouldhqLogoUrl = buildAbsoluteUrl(BOULDHQ_LOGO_PATH, ctx.baseUrl);

      const slug = canonicalName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

      return (
        `Generate a weekly HTML report for the store "${canonicalName}". ` +
        `Use the BouldHQ report template from your instructions. ` +
        `\n\nUse THESE EXACT values when filling the template:\n` +
        `  • {{STORE}} = "${canonicalName}"\n` +
        `  • {{DATE}} = "${today}"\n` +
        `  • {{BOULDHQ_LOGO_URL}} = "${bouldhqLogoUrl}"\n` +
        `  • {{STORE_LOGO_URL}} = ${storeLogoUrl ? `"${storeLogoUrl}"` : '""  (no store logo on file — omit the store-logo <img> entirely, fall back to the store name pill)'}\n` +
        `  • {{STORE_URL}} = ${storeUrl ? `"${storeUrl}"` : '""  (no URL on file — omit the meta link)'}\n` +
        `  • {{STORE_URL_DISPLAY}} = ${storeUrl ? `"${storeUrl.replace(/^https?:\/\//, '')}"` : '""'}\n` +
        `  • {{TIMESTAMP}} = "${new Date().toISOString()}"\n\n` +
        `Use the {{BOULDHQ_LOGO_URL}} value INSIDE the header <img class="bouldhq-mark" src="..."> AND inside the footer mark. ` +
        `Use {{STORE_LOGO_URL}} for the header store mark <img class="store-mark"> if it's set; if it's empty, fall back to the "store" pill with the store name. ` +
        `\nFill report sections with what you know — for missing analytics use the placeholder span. ` +
        `Never invent numbers. Keep bullet lists to 3–6 items each.\n\n` +
        `Then save the document via bouldhq-create-resource-file with: ` +
        `filename="${slug}-${today}.html", ` +
        `folderPath="Branding Assets,${canonicalName},Reports", ` +
        `mimeType="text/html". ` +
        `\nFinally reply to me with the resource path and a 1–2 sentence summary of what's in the report.`
      );
    },
  },
  {
    name: 'help',
    aliases: ['commands'],
    summary: 'List the available slash commands.',
    usage: '/help',
    expand: () =>
      'The user wants the list of slash commands. Reply with a short markdown list — one line per command — showing usage and a one-line description. Do not call any tools.',
  },
  {
    name: 'find',
    summary: 'Search Resources and Notes for something.',
    usage: '/find <query>',
    example: '/find brand colors',
    expand: (rest) => {
      const q = rest.trim();
      if (!q) return 'The user typed `/find` without a query. Ask them what to search for.';
      return (
        `Search the team's Resources AND Notes for: ${q}. ` +
        `Call bouldhq-find-resource (with query="${q}") and search-blinko-tool ` +
        `(with searchText="${q}", isUseAiQuery=true) in parallel, then combine the results ` +
        `in a single short list grouped by source (Resources first, then Notes).`
      );
    },
  },
  {
    name: 'task',
    summary: 'Open a manager task for a store, verbatim wording.',
    usage: '/task <store>: <description>',
    example: '/task joon: owner wants the homepage hero swapped',
    expand: (rest) => {
      const raw = rest.trim();
      if (!raw) {
        return 'The user typed `/task` with no content. Ask which store and what the request is.';
      }
      return (
        `Open a task for the agent manager. The raw user input was: "${raw}". ` +
        `If the user prefixed it with a store name and colon, that's the store. ` +
        `Use bouldhq-list-stores if you need to resolve the store name to a tagId. ` +
        `Pass the user's wording into the task body verbatim — do NOT paraphrase. ` +
        `Use bouldhq-create-task-for-manager.`
      );
    },
  },
];

export async function expandSlashCommand(message: string, ctx: SlashCommandCtx): Promise<string> {
  const m = message.match(/^\/(\w+)\s*([\s\S]*)$/);
  if (!m) return message;
  const [, name, rest] = m;
  const cmd = SLASH_COMMANDS.find(
    (c) => c.name === name || (c.aliases && c.aliases.includes(name)),
  );
  if (!cmd) return message;
  return await Promise.resolve(cmd.expand(rest, ctx));
}

// Plain text for the system prompt — keeps the assistant aware of what
// commands exist without us having to maintain a second list.
export function slashCommandsForPrompt(): string {
  return SLASH_COMMANDS.map((c) => {
    const aliasPart = c.aliases?.length ? ` (alias: ${c.aliases.map((a) => `/${a}`).join(', ')})` : '';
    return `  • ${c.usage}${aliasPart} — ${c.summary}`;
  }).join('\n');
}

// Markdown for the boot-time Commands manual.
export function slashCommandsAsMarkdown(): string {
  const rows = SLASH_COMMANDS.map((c) => {
    const example = c.example || c.usage;
    return `| \`${c.usage}\` | ${c.summary} | \`${example}\` |`;
  }).join('\n');
  return `| Command | What it does | Example |
| --- | --- | --- |
${rows}`;
}

// HTML rows for the boot-time Commands manual. The app's file preview
// renders HTML inline, so we ship the manual as a self-contained .html.
export function slashCommandsAsHtmlRows(): string {
  return SLASH_COMMANDS.map((c) => {
    const example = c.example || c.usage;
    const aliasPart = c.aliases?.length
      ? ` <span class="alias">(alias: ${c.aliases.map((a) => `<code>/${a}</code>`).join(', ')})</span>`
      : '';
    return `<tr>
      <td><code>${c.usage}</code>${aliasPart}</td>
      <td>${c.summary}</td>
      <td><code>${example}</code></td>
    </tr>`;
  }).join('\n');
}

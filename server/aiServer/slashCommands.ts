// Slash-command registry — single source of truth.
//
// The chat UI is a plain textarea. When the user's message starts with
// /<word>, the server (assistantChat) expands it into a longer instruction
// before passing to the agent. The same registry is what the boot-time
// commands manual is generated from, so /help, the system prompt, the doc,
// and the runtime never drift.

export type SlashCommand = {
  name: string;
  aliases?: string[];
  summary: string;
  usage: string;
  example?: string;
  expand: (rest: string) => string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'report',
    summary: 'Generate a weekly HTML report for a store and save it to Resources.',
    usage: '/report <store>',
    example: '/report joon',
    expand: (rest) => {
      const store = rest.trim();
      const today = new Date().toISOString().slice(0, 10);
      if (!store) {
        return 'The user typed `/report` without a store name. Ask them which store you should report on, then list the available stores via bouldhq-list-stores.';
      }
      return (
        `Generate a weekly HTML report for the store "${store}". ` +
        `Use the BouldHQ report template from your instructions (brand-aware CSS vars, ` +
        `sections: Executive Summary, Wins, Issues Fixed, Revenue Opportunities, Metrics, Next Week). ` +
        `Fill the sections with what you know — be explicit when something is a placeholder ` +
        `pending real Shopify/analytics data. ` +
        `Then save it via bouldhq-create-resource-file with: ` +
        `filename="${store.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${today}.html", ` +
        `folderPath="Branding Assets,${store},Reports", ` +
        `mimeType="text/html". ` +
        `Finally reply with the resource path and a one-paragraph summary of what's in the report.`
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

export function expandSlashCommand(message: string): string {
  const m = message.match(/^\/(\w+)\s*([\s\S]*)$/);
  if (!m) return message;
  const [, name, rest] = m;
  const cmd = SLASH_COMMANDS.find(
    (c) => c.name === name || (c.aliases && c.aliases.includes(name)),
  );
  return cmd ? cmd.expand(rest) : message;
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

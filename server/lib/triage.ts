import { AiModelFactory } from '@server/aiServer/aiModelFactory';

export type TriageResult = {
  canAutomate: boolean;
  category: string;
  reasoning: string;
  suggestedAction: string;
};

const PLAYBOOK_CATEGORIES = new Set([
  'shopify_collab_invite',
  'theme_setting_tweak',
  'product_metadata_update',
  'inventory_sync_check',
  'shipping_rate_update',
  'app_install',
  'dns_record_check',
  'email_template_edit',
  'claude_code',
]);

// Synthetic triage used when the LLM isn't configured (or returns garbage).
// Routes the request to the autonomous Claude Code agent instead of letting
// it stall in pending_triage / needs_assistance.
const CLAUDE_FALLBACK: TriageResult = {
  canAutomate: true,
  category: 'claude_code',
  reasoning: 'No LLM configured for triage — falling back to autonomous Claude Code agent.',
  suggestedAction: 'Investigate the request with read-only tools and produce a markdown report.',
};

function extractJson(text: string): unknown | null {
  const trimmed = text.trim();
  // Strip ```json fences if the model added them despite instructions.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    // Try to find the first top-level { ... } block.
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(candidate.slice(start, end + 1)); } catch {}
    }
    return null;
  }
}

function normalize(parsed: unknown): TriageResult | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  const canAutomate = typeof p.canAutomate === 'boolean' ? p.canAutomate : null;
  const category = typeof p.category === 'string' ? p.category : null;
  const reasoning = typeof p.reasoning === 'string' ? p.reasoning : null;
  const suggestedAction = typeof p.suggestedAction === 'string' ? p.suggestedAction : null;
  if (canAutomate === null || !category || !reasoning || !suggestedAction) return null;

  // Sanity: if canAutomate=true, category must be one of the known playbooks.
  // Unknown categories are routed to the Claude Code agent instead of being
  // bounced to a human — the agent will produce a written investigation.
  if (canAutomate && !PLAYBOOK_CATEGORIES.has(category)) {
    return {
      canAutomate: true,
      category: 'claude_code',
      reasoning: `Model suggested unknown category "${category}". Routing to Claude Code agent. ${reasoning}`,
      suggestedAction,
    };
  }
  return { canAutomate, category, reasoning, suggestedAction };
}

// When the LLM isn't configured or the parse fails we return the Claude Code
// fallback so the request still moves into auto_running. The runner will hand
// it to the autonomous Claude Code agent.
export async function triageStoreRequest(rawBody: string): Promise<TriageResult> {
  try {
    const agent = await AiModelFactory.TriageAgent();
    if (!agent) return CLAUDE_FALLBACK;

    const result = await agent.generate([
      { role: 'user', content: rawBody.slice(0, 8000) },
    ]);
    const text = (result as any)?.text ?? '';
    if (!text) return CLAUDE_FALLBACK;

    const parsed = extractJson(text);
    return normalize(parsed) ?? CLAUDE_FALLBACK;
  } catch (err) {
    console.error('triageStoreRequest failed, using Claude Code fallback', err);
    return CLAUDE_FALLBACK;
  }
}

// Status transition derived from a triage result. Triage now always returns a
// result (worst case the Claude Code fallback), so non-automatable requests
// are the only path to needs_assistance.
export function statusFromTriage(triage: TriageResult | null): 'auto_running' | 'needs_assistance' {
  return triage?.canAutomate ? 'auto_running' : 'needs_assistance';
}

import { AsyncLocalStorage } from 'async_hooks';
import { query } from '@repo/database';

// Cost ledger for the web app's LLM and embedding calls; the worker's counterpart is
// apps/worker/providers/ledger.py. Both write provider_usage. What a call was spent on comes from the
// current scope (withLedgerScope), so providers need no knowledge of chats or briefs. Cost is computed
// only when LLM_PRICES_JSON prices the model (USD per million tokens); otherwise it stays NULL.

export interface LedgerScope {
  scopeType?: string;
  scopeId?: string;
  purpose?: string;
}

const storage = new AsyncLocalStorage<LedgerScope>();

export function withLedgerScope<T>(scope: LedgerScope, fn: () => Promise<T>): Promise<T> {
  return storage.run({ ...(storage.getStore() || {}), ...scope }, fn);
}

function costCents(model: string, inputTokens?: number | null, outputTokens?: number | null): number | null {
  try {
    const price = JSON.parse(process.env.LLM_PRICES_JSON || '{}')[model];
    if (!price || inputTokens == null) return null;
    const usd = (inputTokens * (price.input || 0) + (outputTokens || 0) * (price.output || 0)) / 1_000_000;
    return Math.round(usd * 100 * 10000) / 10000;
  } catch {
    return null;
  }
}

export interface UsageEntry {
  provider: string;
  operation: 'chat_completion' | 'chat_stream' | 'embedding';
  model: string;
  startedAt: number;
  success: boolean;
  inputTokens?: number | null;
  outputTokens?: number | null;
  error?: string;
}

/** Records one provider call. Never throws: a ledger failure must not fail the call it meters. */
export function recordUsage(entry: UsageEntry): void {
  const scope = storage.getStore() || {};
  const input = entry.inputTokens ?? null;
  const output = entry.outputTokens ?? null;
  query(
    `INSERT INTO provider_usage (provider, operation, model, duration_ms, tokens_used, input_tokens, output_tokens,
       cost_cents, success, error_message, scope_type, scope_id, purpose)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      entry.provider,
      entry.operation,
      entry.model,
      Date.now() - entry.startedAt,
      (input || 0) + (output || 0),
      input,
      output,
      costCents(entry.model, input, output),
      entry.success,
      entry.error ? entry.error.slice(0, 500) : null,
      scope.scopeType || null,
      scope.scopeId || null,
      scope.purpose || null
    ]
  ).catch((err) => console.warn('[Ledger] Could not record provider usage:', err?.message));
}

/** prompt/completion token counts from an OpenAI-compatible response or final stream chunk. */
export function usageOf(data: any): { inputTokens: number | null; outputTokens: number | null } {
  const usage = data?.usage || {};
  return { inputTokens: usage.prompt_tokens ?? null, outputTokens: usage.completion_tokens ?? null };
}

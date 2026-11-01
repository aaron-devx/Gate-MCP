/**
 * Cache-read projection — client-agnostic math over per-request token usage.
 *
 * Every request re-reads the whole cached prefix, so a token kept out of the
 * context at turn N is saved again on every later turn. Adapters (Claude Code
 * transcripts, OpenCode db) normalize usage into TurnUsage; this module only
 * does arithmetic and never touches the filesystem.
 */

export interface TurnUsage {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

export type ContextWarnLevel = "ok" | "compact" | "clear";

export interface CacheProjectionOptions {
  /** Context size (tokens) at which to suggest /compact. */
  compactAtTokens?: number;
  /** Context size (tokens) at which to suggest /clear or a fresh session. */
  clearAtTokens?: number;
  /** Future requests assumed when projecting compounded savings. */
  remainingTurns?: number;
}

export interface CacheProjection {
  turns: number;
  /** Prompt size of the latest request: input + cache read + cache write. */
  contextTokens: number;
  totalInputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalOutputTokens: number;
  /** Mean prompt growth per request across the session. */
  avgGrowthPerTurn: number;
  remainingTurnsAssumed: number;
  /** Cache reads expected over remainingTurns at current size + growth. */
  projectedCacheReadTokens: number;
  warnLevel: ContextWarnLevel;
}

export const DEFAULT_COMPACT_AT_TOKENS = 120_000;
export const DEFAULT_CLEAR_AT_TOKENS = 160_000;
export const DEFAULT_REMAINING_TURNS = 20;

function envTokens(name: string): number | undefined {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** Thresholds and projection horizon, overridable per client via env. */
export function projectionOptionsFromEnv(): CacheProjectionOptions {
  return {
    compactAtTokens: envTokens("GATE_CONTEXT_COMPACT_TOKENS"),
    clearAtTokens: envTokens("GATE_CONTEXT_CLEAR_TOKENS"),
    remainingTurns: envTokens("GATE_PROJECTION_TURNS"),
  };
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function promptTokens(turn: TurnUsage): number {
  return (
    nonNegative(turn.inputTokens) +
    nonNegative(turn.cacheReadTokens) +
    nonNegative(turn.cacheWriteTokens)
  );
}

export function classifyContext(
  contextTokens: number,
  compactAtTokens = DEFAULT_COMPACT_AT_TOKENS,
  clearAtTokens = DEFAULT_CLEAR_AT_TOKENS
): ContextWarnLevel {
  if (contextTokens >= clearAtTokens) return "clear";
  if (contextTokens >= compactAtTokens) return "compact";
  return "ok";
}

/**
 * Tokens kept out of the context now are re-read (and billed as cache read)
 * on every later request, so the real saving is tokensSaved × remainingTurns.
 */
export function projectCompoundedSaving(
  tokensSaved: number,
  remainingTurns = DEFAULT_REMAINING_TURNS
): number {
  return Math.round(nonNegative(tokensSaved) * nonNegative(remainingTurns));
}

export function summarizeTurns(
  turns: readonly TurnUsage[],
  options: CacheProjectionOptions = {}
): CacheProjection {
  const remainingTurns = nonNegative(
    options.remainingTurns ?? DEFAULT_REMAINING_TURNS
  );
  const totals = turns.reduce(
    (acc, turn) => ({
      input: acc.input + nonNegative(turn.inputTokens),
      cacheRead: acc.cacheRead + nonNegative(turn.cacheReadTokens),
      cacheWrite: acc.cacheWrite + nonNegative(turn.cacheWriteTokens),
      output: acc.output + nonNegative(turn.outputTokens),
    }),
    { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
  );

  const first = turns.length > 0 ? promptTokens(turns[0]) : 0;
  const contextTokens =
    turns.length > 0 ? promptTokens(turns[turns.length - 1]) : 0;
  const avgGrowthPerTurn =
    turns.length > 1
      ? Math.max(0, Math.round((contextTokens - first) / (turns.length - 1)))
      : 0;

  // Arithmetic series: sum over k=1..R of (context + k × growth).
  const projectedCacheReadTokens = Math.round(
    remainingTurns * contextTokens +
      (avgGrowthPerTurn * remainingTurns * (remainingTurns + 1)) / 2
  );

  return {
    turns: turns.length,
    contextTokens,
    totalInputTokens: totals.input,
    totalCacheReadTokens: totals.cacheRead,
    totalCacheWriteTokens: totals.cacheWrite,
    totalOutputTokens: totals.output,
    avgGrowthPerTurn,
    remainingTurnsAssumed: remainingTurns,
    projectedCacheReadTokens,
    warnLevel: classifyContext(
      contextTokens,
      options.compactAtTokens,
      options.clearAtTokens
    ),
  };
}

function compact(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

/** One-line summary suitable for a client status line. */
export function formatStatusLine(projection: CacheProjection): string {
  const parts = [
    `ctx ${compact(projection.contextTokens)}`,
    `+${compact(projection.avgGrowthPerTurn)}/turn`,
    `cache read ${compact(projection.totalCacheReadTokens)}`,
  ];
  if (projection.warnLevel === "compact") parts.push("⚠ /compact");
  if (projection.warnLevel === "clear") parts.push("⛔ /clear");
  return parts.join(" · ");
}

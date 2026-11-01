/**
 * Claude Code adapter — reads per-request usage from a session transcript
 * (JSONL under ~/.claude/projects/<project>/<session>.jsonl).
 *
 * Claude Code writes one line per streamed content block, so the same
 * message.id can appear several times with identical usage. We keep the last
 * line per id, in first-seen order. Sidechain (subagent) lines are skipped:
 * they bill against a separate context.
 */

import fs from "node:fs";
import type { TurnUsage } from "./cacheProjection.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function toTurnUsage(usage: Record<string, unknown>): TurnUsage {
  return {
    inputTokens: asCount(usage.input_tokens),
    cacheReadTokens: asCount(usage.cache_read_input_tokens),
    cacheWriteTokens: asCount(usage.cache_creation_input_tokens),
    outputTokens: asCount(usage.output_tokens),
  };
}

export function parseClaudeTranscript(jsonl: string): TurnUsage[] {
  const byId = new Map<string, TurnUsage>();
  let anonymous = 0;

  for (const line of jsonl.split("\n")) {
    // Cheap prefilter: most lines (tool results, user turns) carry no usage.
    if (!line.includes('"usage"')) continue;
    let entry: Record<string, unknown> | undefined;
    try {
      entry = asRecord(JSON.parse(line));
    } catch {
      continue; // partial line while Claude Code is still writing
    }
    if (!entry || entry.type !== "assistant" || entry.isSidechain === true) {
      continue;
    }
    const message = asRecord(entry.message);
    const usage = asRecord(message?.usage);
    if (!message || !usage) continue;

    const id =
      typeof message.id === "string" ? message.id : `anon-${anonymous++}`;
    byId.set(id, toTurnUsage(usage));
  }

  return [...byId.values()];
}

export function readClaudeTranscript(transcriptPath: string): TurnUsage[] {
  return parseClaudeTranscript(fs.readFileSync(transcriptPath, "utf8"));
}

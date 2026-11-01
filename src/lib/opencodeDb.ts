/**
 * OpenCode adapter — reads per-request usage from OpenCode's SQLite store
 * (~/.local/share/opencode/opencode.db, verified against OpenCode v2.0.11).
 *
 * Each `session_message` row of type "assistant" is one model request and
 * carries `data.tokens = {input, output, reasoning, cache: {read, write}}`.
 * The database is opened read-only; OpenCode keeps writing to it.
 */

import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { Database as BetterSqliteDatabase } from "better-sqlite3";
import type { TurnUsage } from "./cacheProjection.js";

const require = createRequire(import.meta.url);

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

export function defaultOpencodeDbPath(): string {
  if (process.env.GATE_OPENCODE_DB) return process.env.GATE_OPENCODE_DB;
  const dataHome =
    process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(dataHome, "opencode", "opencode.db");
}

/** Pure parser over `session_message.data` JSON strings, in request order. */
export function parseOpencodeMessages(rows: readonly string[]): TurnUsage[] {
  const turns: TurnUsage[] = [];
  for (const row of rows) {
    let data: Record<string, unknown> | undefined;
    try {
      data = asRecord(JSON.parse(row));
    } catch {
      continue;
    }
    const tokens = asRecord(data?.tokens);
    if (!tokens) continue;
    const cache = asRecord(tokens.cache) ?? {};
    turns.push({
      inputTokens: asCount(tokens.input),
      cacheReadTokens: asCount(cache.read),
      cacheWriteTokens: asCount(cache.write),
      outputTokens: asCount(tokens.output) + asCount(tokens.reasoning),
    });
  }
  return turns;
}

function latestSessionId(db: BetterSqliteDatabase): string | undefined {
  // Subagent sessions (parent_id set) bill against their own context.
  const row = db
    .prepare(
      `SELECT m.session_id AS id FROM session_message m
       JOIN session_v2 s ON s.id = m.session_id
       WHERE m.type = 'assistant' AND s.parent_id IS NULL
       ORDER BY m.time_created DESC LIMIT 1`
    )
    .get() as { id?: string } | undefined;
  return row?.id;
}

export interface OpencodeSessionUsage {
  sessionId: string;
  turns: TurnUsage[];
}

/** Reads one session (default: most recently active top-level session). */
export function readOpencodeSession(
  dbPath: string = defaultOpencodeDbPath(),
  sessionId?: string
): OpencodeSessionUsage {
  const Database = require("better-sqlite3") as typeof import("better-sqlite3");
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const id = sessionId ?? latestSessionId(db);
    if (!id) throw new Error(`no OpenCode sessions in ${dbPath}`);
    const rows = db
      .prepare(
        `SELECT data FROM session_message
         WHERE session_id = ? AND type = 'assistant' ORDER BY seq`
      )
      .all(id) as Array<{ data: string }>;
    return { sessionId: id, turns: parseOpencodeMessages(rows.map((r) => r.data)) };
  } finally {
    db.close();
  }
}

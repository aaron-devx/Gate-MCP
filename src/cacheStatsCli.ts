/**
 * CLI entry points for cache-read projection.
 *
 *   gatemcp cache-stats <transcript.jsonl> [--json]
 *   gatemcp cache-stats --opencode [session_id] [--json]   (latest session by default)
 *   gatemcp statusline   (Claude Code statusLine command; JSON on stdin)
 */

import {
  formatStatusLine,
  projectionOptionsFromEnv,
  summarizeTurns,
  type CacheProjection,
} from "./lib/cacheProjection.js";
import { readClaudeTranscript } from "./lib/claudeTranscript.js";
import { readOpencodeSession } from "./lib/opencodeDb.js";

export function projectTranscript(transcriptPath: string): CacheProjection {
  return summarizeTurns(
    readClaudeTranscript(transcriptPath),
    projectionOptionsFromEnv()
  );
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/** Never throws: a broken status line must not break the client UI. */
export async function runStatusLine(): Promise<void> {
  try {
    const input: unknown = JSON.parse(await readStdin());
    const transcriptPath =
      typeof input === "object" && input !== null
        ? (input as { transcript_path?: unknown }).transcript_path
        : undefined;
    if (typeof transcriptPath !== "string" || transcriptPath.length === 0) {
      process.stdout.write("ctx n/a\n");
      return;
    }
    process.stdout.write(
      `${formatStatusLine(projectTranscript(transcriptPath))}\n`
    );
  } catch {
    process.stdout.write("ctx n/a\n");
  }
}

const CACHE_STATS_USAGE =
  "usage: gatemcp cache-stats <transcript.jsonl> [--json]\n" +
  "       gatemcp cache-stats --opencode [session_id] [--json]\n";

function projectFromArgs(args: readonly string[]): CacheProjection | undefined {
  const target = args.find((arg) => !arg.startsWith("--"));
  if (args.includes("--opencode")) {
    const { turns } = readOpencodeSession(undefined, target);
    return summarizeTurns(turns, projectionOptionsFromEnv());
  }
  return target ? projectTranscript(target) : undefined;
}

export function runCacheStats(args: readonly string[]): number {
  try {
    const projection = projectFromArgs(args);
    if (!projection) {
      process.stderr.write(CACHE_STATS_USAGE);
      return 2;
    }
    const output = args.includes("--json")
      ? JSON.stringify(projection, null, 2)
      : formatStatusLine(projection);
    process.stdout.write(`${output}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`cache-stats failed: ${err}\n`);
    return 1;
  }
}

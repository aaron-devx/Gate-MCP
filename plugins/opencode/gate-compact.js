/**
 * Gate-MCP OpenCode plugin: keep working state across compaction.
 *
 * Install: copy to ~/.config/opencode/plugins/ (global) or .opencode/plugins/.
 * On `experimental.session.compacting` it snapshots git branch/status/last
 * commit, injects that into the compaction prompt, and writes it to
 * <project>/.ogi/compactions/<UTC>-PreCompact.md (newest 20 kept) — the same
 * layout as the Claude Code PreCompact hook. Never throws into OpenCode.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const KEEP_FILES = 20;
const GIT_TIMEOUT_MS = 5000;

function git(cwd, ...args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function snapshot(cwd, sessionId) {
  return [
    "## Gate state before compaction",
    `- Session: ${sessionId ?? "?"}`,
    `- Branch: ${git(cwd, "rev-parse", "--abbrev-ref", "HEAD") || "n/a"}`,
    `- Last commit: ${git(cwd, "log", "--oneline", "-1") || "n/a"}`,
    "",
    "git status --short:",
    "```",
    git(cwd, "status", "--short") || "(clean or not a repo)",
    "```",
  ].join("\n");
}

function persist(cwd, body) {
  const outDir = path.join(cwd, ".ogi", "compactions");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  fs.writeFileSync(path.join(outDir, `${stamp}-PreCompact.md`), `${body}\n`, "utf8");
  const files = fs.readdirSync(outDir).filter((f) => f.endsWith(".md")).sort();
  for (const old of files.slice(0, Math.max(0, files.length - KEEP_FILES))) {
    fs.rmSync(path.join(outDir, old), { force: true });
  }
}

export const GateCompactPlugin = async ({ directory, worktree }) => {
  const cwd = worktree || directory || process.cwd();
  return {
    "experimental.session.compacting": async (input, output) => {
      try {
        const body = snapshot(cwd, input?.sessionID);
        output.context.push(body);
        persist(cwd, body);
      } catch (err) {
        console.error(`gate-compact: ${err}`);
      }
    },
  };
};

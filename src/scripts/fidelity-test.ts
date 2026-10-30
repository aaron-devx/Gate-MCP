/**
 * gatemcp v0.3.2 — Symbol Fidelity Test (Experiment #4a).
 *
 * The compression claim "92-97% input-token reduction" is meaningless if the
 * compressed view drops important symbols. This script measures whether the
 * AST-based signature extractor preserves the symbols a developer (or LLM)
 * actually cares about: top-level exported functions, classes, and variables.
 *
 * Method:
 *   1. For each .js/.ts/.tsx file in the target directory, extract the
 *      ground-truth set of exported symbol names from the RAW source using
 *      a comprehensive regex that handles every common export form.
 *   2. Compress the file via the AST extractor and pull the names back out
 *      of the compressed signature output.
 *   3. Compute recall = |compressed ∩ truth| / |truth|.
 *   4. Aggregate over all files and report distributions, not just averages.
 *
 * Why this matters (FAIROS Principle 1 — truth before execution):
 *   Token savings without fidelity is just lossy compression. The whole
 *   value proposition rests on the compressed view being usable.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  detectLanguage,
  extractSignatures,
  formatSignature,
} from "../lib/astParser.js";
import {
  buildExportTruthFromSource,
  scoreExportRecallInView,
} from "../lib/validation.js";
import type { SupportedLanguage } from "../types.js";

const CODE_EXTENSIONS = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts",
]);

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next",
  "coverage", ".cache", "__tests__", "test", "tests",
]);

interface FileResult {
  filePath: string;
  language: SupportedLanguage | "unknown";
  truthSymbols: string[];
  compressedSymbols: string[];
  recall: number;
  precision: number;
  missed: string[];
}

function expandHome(p: string): string {
  if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
  return p;
}

function walkSync(root: string, files: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) walkSync(full, files);
    else if (entry.isFile() && CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(full);
    }
  }
  return files;
}

function measureFile(filePath: string): FileResult | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
  if (raw.length === 0) return null;

  const language = detectLanguage(filePath);
  const { symbols: truthSymbols } = buildExportTruthFromSource(raw, language);
  if (truthSymbols.length === 0) return null; // no exports = nothing to measure

  let compressed = "";
  try {
    const sig = extractSignatures(raw, language);
    compressed = formatSignature(sig, language);
  } catch {
    compressed = "";
  }
  const scored = scoreExportRecallInView(compressed, truthSymbols);
  const compressedSet = new Set(
    compressed.match(/[A-Za-z_$][\w$]*/g) ?? []
  );

  return {
    filePath,
    language,
    truthSymbols,
    compressedSymbols: Array.from(compressedSet),
    recall: scored.recall,
    precision:
      compressedSet.size > 0 ? scored.symbolsPresent.length / compressedSet.size : 0,
    missed: scored.symbolsMissed,
  };
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function bucket(recall: number): string {
  if (recall >= 1.0) return "100%";
  if (recall >= 0.95) return "95-99%";
  if (recall >= 0.90) return "90-94%";
  if (recall >= 0.75) return "75-89%";
  if (recall >= 0.50) return "50-74%";
  return "<50%";
}

async function main() {
  const target = expandHome(process.argv[2] ?? "");
  if (!target || !fs.existsSync(target)) {
    console.error("Usage: fidelity-test <target-dir>");
    process.exit(1);
  }
  const abs = path.resolve(target);
  console.log(`[fidelity] scanning ${abs}`);

  const files = walkSync(abs);
  console.log(`[fidelity] discovered ${files.length} JS/TS files`);

  const results: FileResult[] = [];
  for (const f of files) {
    const r = measureFile(f);
    if (r) results.push(r);
  }

  if (results.length === 0) {
    console.log("[fidelity] no files with exports found — nothing to measure");
    return;
  }

  const totalTruth = results.reduce((s, r) => s + r.truthSymbols.length, 0);
  const totalFound = results.reduce(
    (s, r) => s + (r.truthSymbols.length - r.missed.length),
    0
  );
  const overallRecall = totalFound / totalTruth;
  const avgRecall = results.reduce((s, r) => s + r.recall, 0) / results.length;

  const buckets = new Map<string, number>();
  for (const r of results) {
    const b = bucket(r.recall);
    buckets.set(b, (buckets.get(b) ?? 0) + 1);
  }

  const worst = [...results].sort((a, b) => a.recall - b.recall).slice(0, 10);

  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(" gatemcp Symbol Fidelity Report (Experiment #4a)");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`Files measured:         ${results.length}`);
  console.log(`Total exported symbols: ${totalTruth}`);
  console.log(`Symbols preserved:      ${totalFound}`);
  console.log(`Symbols lost:           ${totalTruth - totalFound}`);
  console.log("");
  console.log(`Overall recall (symbol-weighted): ${pct(overallRecall)}`);
  console.log(`Average recall (file-weighted):   ${pct(avgRecall)}`);
  console.log("");
  console.log("Recall distribution:");
  const order = ["100%", "95-99%", "90-94%", "75-89%", "50-74%", "<50%"];
  for (const b of order) {
    const count = buckets.get(b) ?? 0;
    const bar = "█".repeat(Math.round((count / results.length) * 40));
    console.log(`  ${b.padEnd(8)} ${String(count).padStart(5)} files  ${bar}`);
  }
  console.log("");
  if (worst.length > 0 && worst[0].recall < 1.0) {
    console.log("10 worst files by recall:");
    for (const r of worst) {
      if (r.recall === 1.0) break;
      const rel = path.relative(abs, r.filePath);
      console.log(`  ${pct(r.recall).padStart(6)}  ${rel}`);
      if (r.missed.length > 0 && r.missed.length <= 5) {
        console.log(`           missed: ${r.missed.join(", ")}`);
      } else if (r.missed.length > 5) {
        console.log(`           missed: ${r.missed.slice(0, 5).join(", ")}, ... (${r.missed.length - 5} more)`);
      }
    }
  } else {
    console.log("No files below 100% recall — perfect fidelity.");
  }
  console.log("");

  // Exit non-zero if recall is unacceptable for a release
  if (overallRecall < 0.95) {
    console.error(`[fidelity] FAIL — overall recall ${pct(overallRecall)} below 95% threshold`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("[fidelity] fatal:", err);
  process.exit(1);
});

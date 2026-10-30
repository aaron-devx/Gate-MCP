/**
 * Prototype-style public surface: `app.use = function`, chained `res.set =` /
 * `res.header = function`, and Express-style `app[method] = function` loops.
 */
import type { FileSignature } from "../types.js";

const RECEIVER_SKIP = new Set([
  "module",
  "exports",
  "require",
  "Object",
  "Function",
  "Number",
  "String",
  "Array",
  "Boolean",
]);

/** HTTP verbs commonly assigned via methods.forEach in Express application.js */
const DYNAMIC_HTTP_VERBS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
  "connect",
  "trace",
] as const;

export function stripSourceComments(source: string): string {
  return source
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function addDotted(symbols: Set<string>, recv: string, prop: string): void {
  if (RECEIVER_SKIP.has(recv)) return;
  symbols.add(`${recv}.${prop}`);
}

export type PrototypeExportScan = {
  symbols: Set<string>;
  /** Lines like `app.use(...)` for compressed signature views */
  functionLines: string[];
  dynamicExportsSuspected: boolean;
};

/**
 * Collect prototype assignment surface from JS/TS source (comments stripped).
 */
export function scanPrototypeExports(source: string): PrototypeExportScan {
  const stripped = stripSourceComments(source);
  const symbols = new Set<string>();
  const functionLines: string[] = [];
  let dynamicExportsSuspected = false;

  const directRe =
    /^\s*([A-Za-z_$][\w$]{1,})\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function/gm;
  let m: RegExpExecArray | null;
  while ((m = directRe.exec(stripped)) !== null) {
    addDotted(symbols, m[1], m[2]);
    functionLines.push(`${m[1]}.${m[2]}(...)`);
  }

  const sameLineChainRe =
    /^\s*([A-Za-z_$][\w$]{1,})\.([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]{1,})\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function/gm;
  while ((m = sameLineChainRe.exec(stripped)) !== null) {
    addDotted(symbols, m[1], m[2]);
    addDotted(symbols, m[3], m[4]);
    functionLines.push(`${m[1]}.${m[2]}(...)`);
    functionLines.push(`${m[3]}.${m[4]}(...)`);
  }

  const lines = stripped.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const pending = lines[i].match(
      /^\s*([A-Za-z_$][\w$]{1,})\.([A-Za-z_$][\w$]*)\s*=\s*$/
    );
    if (!pending) continue;
    addDotted(symbols, pending[1], pending[2]);
    functionLines.push(`${pending[1]}.${pending[2]}(...)`);
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const fn = lines[j].match(
        /^\s*([A-Za-z_$][\w$]{1,})\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function/
      );
      if (fn) {
        addDotted(symbols, fn[1], fn[2]);
        functionLines.push(`${fn[1]}.${fn[2]}(...)`);
        break;
      }
    }
  }

  const dynamicLoop =
    /methods\.forEach\s*\(\s*function\s*\(\s*(\w+)\s*\)\s*\{[\s\S]{0,800}?\bapp\s*\[\s*\1\s*\]\s*=\s*(?:async\s+)?function/m;
  if (dynamicLoop.test(stripped)) {
    dynamicExportsSuspected = true;
    for (const verb of DYNAMIC_HTTP_VERBS) {
      addDotted(symbols, "app", verb);
      functionLines.push(`app.${verb}(...)`);
    }
  }

  return { symbols, functionLines, dynamicExportsSuspected };
}

export function augmentSignatureWithPrototypeMethods(
  source: string,
  result: FileSignature
): boolean {
  const scan = scanPrototypeExports(source);
  const seen = new Set(result.functions);
  for (const line of scan.functionLines) {
    if (!seen.has(line)) {
      result.functions.push(line);
      seen.add(line);
    }
  }
  return scan.dynamicExportsSuspected;
}

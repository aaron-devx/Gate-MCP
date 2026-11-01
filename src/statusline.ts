/**
 * Lean Claude Code statusLine entry — skips MCP server init so the status
 * line stays fast and quiet. Configure as: node <repo>/dist/statusline.js
 */

import { runStatusLine } from "./cacheStatsCli.js";

void runStatusLine();

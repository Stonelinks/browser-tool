#!/usr/bin/env bun
/**
 * browser-tool HTTP daemon
 *
 * A lightweight HTTP server that exposes all 10 browser-tool actions over
 * JSON endpoints so that external tools (like pi skills) can drive a
 * persistent browser session via curl.
 *
 * Usage:
 *   bun run src/daemon.ts                # start on port 9515
 *   BROWSER_TOOL_PORT=8080 bun run src/daemon.ts
 *
 * Endpoints:
 *   GET  /health        — returns { ok: true, sessions: N }
 *   POST /shutdown      — graceful shutdown
 *   POST /close-all     — close all browser sessions (keeps daemon running)
 *   POST /navigate      — { url, task_id? }
 *   POST /snapshot      — { full?, task_id? }
 *   POST /click         — { ref, task_id? }
 *   POST /type          — { ref, text, submit?, task_id? }
 *   POST /scroll        — { direction, pixels?, task_id? }
 *   POST /back          — { task_id? }
 *   POST /press         — { key, task_id? }
 *   POST /console       — { clear?, expression?, task_id? }
 *   POST /network       — { clear?, filter?, task_id? }
 *   POST /get-images    — { task_id? }
 *   POST /vision        — { question, annotate?, model?, task_id? }
 */

import { browserNavigate } from "./actions/navigate.js";
import { browserSnapshot } from "./actions/snapshot.js";
import { browserClick } from "./actions/click.js";
import { browserType } from "./actions/type.js";
import { browserScroll } from "./actions/scroll.js";
import { browserBack } from "./actions/back.js";
import { browserPress } from "./actions/press.js";
import { browserConsole } from "./actions/console.js";
import { browserGetImages } from "./actions/getImages.js";
import { browserVision } from "./actions/vision.js";
import { browserNetwork } from "./actions/network.js";
import { SessionManager } from "./session/manager.js";
import { logError, logDebug } from "./logger.js";
import { createDaemonHandler, type ActionHandler } from "./daemon-handler.js";

const PORT = parseInt(process.env.BROWSER_TOOL_PORT ?? "9515", 10);

// Action handlers — each maps to the library function
const actions: Record<string, ActionHandler> = {
  navigate: async (b) =>
    browserNavigate({
      url: b.url as string,
      taskId: b.task_id as string | undefined,
    }) as any,
  snapshot: async (b) =>
    browserSnapshot({
      full: b.full as boolean | undefined,
      taskId: b.task_id as string | undefined,
    }) as any,
  click: async (b) =>
    browserClick({
      ref: b.ref as string,
      taskId: b.task_id as string | undefined,
    }) as any,
  type: async (b) =>
    browserType({
      ref: b.ref as string,
      text: b.text as string,
      submit: b.submit as boolean | undefined,
      taskId: b.task_id as string | undefined,
    }) as any,
  scroll: async (b) =>
    browserScroll({
      direction: b.direction as "up" | "down",
      pixels: b.pixels as number | undefined,
      taskId: b.task_id as string | undefined,
    }) as any,
  back: async (b) =>
    browserBack({ taskId: b.task_id as string | undefined }) as any,
  press: async (b) =>
    browserPress({
      key: b.key as string,
      taskId: b.task_id as string | undefined,
    }) as any,
  console: async (b) =>
    browserConsole({
      clear: b.clear as boolean | undefined,
      expression: b.expression as string | undefined,
      taskId: b.task_id as string | undefined,
    }) as any,
  "get-images": async (b) =>
    browserGetImages({ taskId: b.task_id as string | undefined }) as any,
  vision: async (b) =>
    browserVision({
      question: b.question as string,
      annotate: b.annotate as boolean | undefined,
      model: b.model as string | undefined,
      taskId: b.task_id as string | undefined,
    }) as any,
  network: async (b) =>
    browserNetwork({
      clear: b.clear as boolean | undefined,
      filter: b.filter as
        | {
            url_pattern?: string;
            resource_type?: string;
            method?: string;
            status_code?: number;
          }
        | undefined,
      taskId: b.task_id as string | undefined,
    }) as any,
};

const handler = createDaemonHandler(actions);

const server = Bun.serve({
  port: PORT,
  fetch: handler,
});

// Graceful shutdown on signals
let shuttingDown = false;
async function gracefulShutdown(
  signal: string,
  exitCode: number,
): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logDebug("daemon received", signal);
  try {
    await Promise.race([
      SessionManager.getInstance().closeAll(),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]);
  } catch (err) {
    logError("shutdown error", err);
  }
  server.stop();
  process.exit(exitCode);
}

process.on("SIGINT", () => void gracefulShutdown("SIGINT", 130));
process.on("SIGTERM", () => void gracefulShutdown("SIGTERM", 143));

console.error(`[browser-tool daemon] listening on http://localhost:${PORT}`);

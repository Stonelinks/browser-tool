/**
 * Daemon HTTP handler — pure logic separated from server startup so it can be
 * unit-tested without side-effects.
 */

import { SessionManager } from "./session/manager.js";
import { logError, logDebug } from "./logger.js";

export type ActionHandler = (
  body: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Create the fetch handler for the daemon.  Accepts an actions map so tests
 * can inject mocks; the real daemon passes the production action map.
 */
export function createDaemonHandler(
  actions: Record<string, ActionHandler>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/$/, ""); // strip trailing slash

    logDebug("daemon request", req.method, path);

    // Health check
    if (path === "/health" && req.method === "GET") {
      return json(200, {
        ok: true,
        sessions: SessionManager.getInstance().size(),
      });
    }

    // Graceful shutdown
    if (path === "/shutdown" && req.method === "POST") {
      logDebug("daemon shutting down via /shutdown");
      void (async () => {
        await SessionManager.getInstance().closeAll();
        process.exit(0);
      })();
      return json(200, { ok: true, message: "shutting down" });
    }

    // Close all sessions (keep daemon alive)
    if (path === "/close-all" && req.method === "POST") {
      await SessionManager.getInstance().closeAllSessions();
      return json(200, { ok: true });
    }

    // Action endpoints
    if (req.method === "POST") {
      const actionName = path.slice(1);
      const handler = actions[actionName];
      if (handler) {
        let body: Record<string, unknown>;
        try {
          body = (await req.json()) as Record<string, unknown>;
        } catch {
          return json(400, { success: false, error: "Invalid JSON body" });
        }
        try {
          const result = await handler(body);
          return json(200, result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logError("action error", err);
          return json(500, { success: false, error: message });
        }
      }
    }

    return json(404, {
      success: false,
      error: `Unknown endpoint: ${req.method} ${path}`,
    });
  };
}

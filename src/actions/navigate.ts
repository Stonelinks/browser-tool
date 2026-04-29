import { withSession, failure, errorMessage } from "./_helpers.js";
import { buildSnapshot } from "../snapshot/snapshot.js";
import type { ActionResult, NavigateResult } from "../types.js";
import { getConfig } from "../config.js";

export interface NavigateInput {
  url: string;
  taskId?: string;
}

export async function browserNavigate(input: NavigateInput): Promise<ActionResult<NavigateResult>> {
  const url = input.url?.trim();
  if (!url) return failure("url is required");
  let normalized = url;
  if (!/^https?:\/\//i.test(normalized) && !normalized.startsWith("file://") && !normalized.startsWith("about:")) {
    normalized = `https://${normalized}`;
  }
  return withSession(input.taskId, async (session) => {
    const cfg = getConfig();
    try {
      await session.page.goto(normalized, {
        waitUntil: "domcontentloaded",
        timeout: cfg.commandTimeoutMs,
      });
    } catch (err) {
      return failure(`navigation failed: ${errorMessage(err)}`);
    }
    try {
      const snap = await buildSnapshot(session.page, { full: false });
      session.lastSnapshotAt = Date.now();
      return {
        success: true,
        url: snap.url,
        title: snap.title,
        snapshot: snap.text,
        element_count: snap.refCount,
        truncated: snap.truncated || undefined,
      } as ActionResult<NavigateResult>;
    } catch (err) {
      return failure(`snapshot after navigation failed: ${errorMessage(err)}`);
    }
  });
}

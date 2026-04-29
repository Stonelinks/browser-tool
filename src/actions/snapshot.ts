import { withSession, failure, errorMessage } from "./_helpers.js";
import { buildSnapshot } from "../snapshot/snapshot.js";
import type { ActionResult, SnapshotResult } from "../types.js";

export interface SnapshotInput {
  full?: boolean;
  taskId?: string;
}

export async function browserSnapshot(input: SnapshotInput = {}): Promise<ActionResult<SnapshotResult>> {
  return withSession(input.taskId, async (session) => {
    try {
      const snap = await buildSnapshot(session.page, { full: input.full });
      session.lastSnapshotAt = Date.now();
      return {
        success: true,
        snapshot: snap.text,
        element_count: snap.refCount,
        truncated: snap.truncated || undefined,
        url: snap.url,
        title: snap.title,
      } as ActionResult<SnapshotResult>;
    } catch (err) {
      return failure(`snapshot failed: ${errorMessage(err)}`);
    }
  });
}

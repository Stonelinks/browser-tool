import { withSession, failure, errorMessage } from "./_helpers.js";
import type { ActionResult, BackResult } from "../types.js";

export interface BackInput {
  taskId?: string;
}

export async function browserBack(input: BackInput = {}): Promise<ActionResult<BackResult>> {
  return withSession(input.taskId, async (session) => {
    try {
      const resp = await session.page.goBack({ waitUntil: "domcontentloaded", timeout: 10000 });
      if (resp === null) {
        return failure("nothing to go back to (no prior history)");
      }
      return {
        success: true,
        url: session.page.url(),
        title: await session.page.title(),
      } as ActionResult<BackResult>;
    } catch (err) {
      return failure(`back failed: ${errorMessage(err)}`);
    }
  });
}

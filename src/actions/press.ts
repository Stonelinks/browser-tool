import { withSession, failure, errorMessage } from "./_helpers.js";
import type { ActionResult, PressResult } from "../types.js";

export interface PressInput {
  key: string;
  taskId?: string;
}

export async function browserPress(
  input: PressInput,
): Promise<ActionResult<PressResult>> {
  if (!input.key) return failure("key is required");
  return withSession(input.taskId, async (session) => {
    try {
      await session.page.keyboard.press(input.key);
      await session.page
        .waitForLoadState("domcontentloaded", { timeout: 2000 })
        .catch(() => undefined);
      return {
        success: true,
        pressed: input.key,
      } as ActionResult<PressResult>;
    } catch (err) {
      return failure(`press failed: ${errorMessage(err)}`);
    }
  });
}

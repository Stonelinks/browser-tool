import {
  withSession,
  failure,
  errorMessage,
  refSelector,
  refNumber,
} from "./_helpers.js";
import type { ActionResult, ClickResult } from "../types.js";
import { getConfig } from "../config.js";

export interface ClickInput {
  ref: string;
  taskId?: string;
}

export async function browserClick(
  input: ClickInput,
): Promise<ActionResult<ClickResult>> {
  if (!input.ref) return failure("ref is required");
  let selector: string;
  let n: string;
  try {
    selector = refSelector(input.ref);
    n = refNumber(input.ref);
  } catch (err) {
    return failure(errorMessage(err));
  }
  return withSession(input.taskId, async (session) => {
    const cfg = getConfig();
    const locator = session.page.locator(selector).first();
    try {
      const count = await session.page.locator(selector).count();
      if (count === 0) {
        return failure(
          `Element @e${n} not found. Page may have changed; call browser_snapshot to refresh refs.`,
        );
      }
      await locator
        .scrollIntoViewIfNeeded({ timeout: cfg.commandTimeoutMs })
        .catch(() => undefined);
      await locator.click({ timeout: cfg.commandTimeoutMs });
      // Allow any client-side navigation to settle
      await session.page
        .waitForLoadState("domcontentloaded", { timeout: 5000 })
        .catch(() => undefined);
      return {
        success: true,
        clicked: `@e${n}`,
        url: session.page.url(),
      } as ActionResult<ClickResult>;
    } catch (err) {
      return failure(`click failed: ${errorMessage(err)}`);
    }
  });
}

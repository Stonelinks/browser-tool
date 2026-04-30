import {
  withSession,
  failure,
  errorMessage,
  refSelector,
  refNumber,
} from "./_helpers.js";
import type { ActionResult, TypeResult } from "../types.js";
import { getConfig } from "../config.js";

export interface TypeInput {
  ref: string;
  text: string;
  submit?: boolean;
  taskId?: string;
}

export async function browserType(
  input: TypeInput,
): Promise<ActionResult<TypeResult>> {
  if (!input.ref) return failure("ref is required");
  if (typeof input.text !== "string") return failure("text is required");
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
      await locator.fill(input.text, { timeout: cfg.commandTimeoutMs });
      if (input.submit) {
        await locator.press("Enter", { timeout: cfg.commandTimeoutMs });
        await session.page
          .waitForLoadState("domcontentloaded", { timeout: 5000 })
          .catch(() => undefined);
      }
      return {
        success: true,
        typed: input.text,
        ref: `@e${n}`,
        submitted: !!input.submit,
      } as ActionResult<TypeResult>;
    } catch (err) {
      return failure(`type failed: ${errorMessage(err)}`);
    }
  });
}

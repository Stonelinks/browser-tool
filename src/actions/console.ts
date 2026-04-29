import { withSession, failure, errorMessage } from "./_helpers.js";
import type { ActionResult, ConsoleBuffersResult, ConsoleEvalResult } from "../types.js";

export interface ConsoleInput {
  clear?: boolean;
  expression?: string;
  taskId?: string;
}

export async function browserConsole(
  input: ConsoleInput = {},
): Promise<ActionResult<ConsoleBuffersResult | ConsoleEvalResult>> {
  return withSession(input.taskId, async (session) => {
    if (input.expression) {
      try {
        const value = await session.page.evaluate((expr: string) => {
          // eslint-disable-next-line no-new-func
          const fn = new Function(`return (${expr});`);
          return fn();
        }, input.expression);
        return {
          success: true,
          result: value,
          result_type: typeof value,
        } as ActionResult<ConsoleEvalResult>;
      } catch (err) {
        return failure(`expression failed: ${errorMessage(err)}`);
      }
    }
    const consoleMessages = [...session.consoleBuffer];
    const errors = [...session.errorBuffer];
    if (input.clear) session.clearBuffers();
    return {
      success: true,
      console_messages: consoleMessages,
      js_errors: errors,
      total_messages: consoleMessages.length,
      total_errors: errors.length,
    } as ActionResult<ConsoleBuffersResult>;
  });
}

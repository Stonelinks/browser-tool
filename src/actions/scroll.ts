import { withSession, failure, errorMessage } from "./_helpers.js";
import type { ActionResult, ScrollResult } from "../types.js";

export interface ScrollInput {
  direction: "up" | "down";
  pixels?: number;
  taskId?: string;
}

export async function browserScroll(input: ScrollInput): Promise<ActionResult<ScrollResult>> {
  if (input.direction !== "up" && input.direction !== "down") {
    return failure(`invalid direction "${input.direction}"; expected "up" or "down"`);
  }
  const pixels = input.pixels ?? 600;
  return withSession(input.taskId, async (session) => {
    try {
      const dy = input.direction === "down" ? pixels : -pixels;
      const scrollY = await session.page.evaluate((delta: number) => {
        window.scrollBy(0, delta);
        return window.scrollY;
      }, dy);
      return {
        success: true,
        direction: input.direction,
        pixels,
        scrollY,
      } as ActionResult<ScrollResult>;
    } catch (err) {
      return failure(`scroll failed: ${errorMessage(err)}`);
    }
  });
}

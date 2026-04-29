import { z } from "zod";
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
import type { ActionResult } from "./types.js";

const taskId = z
  .string()
  .optional()
  .describe('Optional task ID to isolate this browser session from others. Defaults to "default".');

export const NavigateSchema = z.object({
  url: z.string().describe("URL to navigate to. Will prepend https:// if missing."),
  task_id: taskId,
});
export const SnapshotSchema = z.object({
  full: z
    .boolean()
    .optional()
    .describe("If true, include text/headings/paragraphs in addition to interactive elements."),
  task_id: taskId,
});
export const ClickSchema = z.object({
  ref: z.string().describe('Element reference like "@e5" from the latest snapshot.'),
  task_id: taskId,
});
export const TypeSchema = z.object({
  ref: z.string().describe('Element reference like "@e3" for the input/textarea to fill.'),
  text: z.string().describe("Text to type into the field. Replaces existing value."),
  submit: z.boolean().optional().describe("If true, press Enter after typing."),
  task_id: taskId,
});
export const ScrollSchema = z.object({
  direction: z.enum(["up", "down"]).describe("Scroll direction."),
  pixels: z.number().int().positive().optional().describe("Pixels to scroll. Default 600."),
  task_id: taskId,
});
export const BackSchema = z.object({ task_id: taskId });
export const PressSchema = z.object({
  key: z
    .string()
    .describe('Key name to press (Playwright format), e.g. "Enter", "Tab", "Escape", "Control+a".'),
  task_id: taskId,
});
export const ConsoleSchema = z.object({
  clear: z.boolean().optional().describe("If true, clear the console buffers after returning them."),
  expression: z
    .string()
    .optional()
    .describe("Optional JavaScript expression to evaluate in the page context. If set, returns the result instead of buffered logs."),
  task_id: taskId,
});
export const GetImagesSchema = z.object({ task_id: taskId });
export const VisionSchema = z.object({
  question: z.string().describe("Question to ask about the screenshot of the current page."),
  annotate: z
    .boolean()
    .optional()
    .describe("If true, overlay numbered boxes on interactive elements before screenshotting (requires a prior snapshot)."),
  model: z.string().optional().describe("Override the Anthropic vision model."),
  task_id: taskId,
});

export type ToolHandler = (args: Record<string, unknown>) => Promise<ActionResult>;

function adapt<T extends z.ZodTypeAny>(
  schema: T,
  fn: (parsed: z.infer<T>) => Promise<ActionResult>,
): ToolHandler {
  return async (args) => {
    const parseResult = schema.safeParse(args ?? {});
    if (!parseResult.success) {
      const issues = parseResult.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      return { success: false, error: `Invalid arguments: ${issues}` };
    }
    return fn(parseResult.data);
  };
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: ToolHandler;
}

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: "browser_navigate",
    description:
      "Navigate the browser to a URL. Returns a compact accessibility-tree snapshot of the page with interactive elements tagged [ref @eN] for use with browser_click and browser_type.",
    inputSchema: NavigateSchema,
    handler: adapt(NavigateSchema, (a) => browserNavigate({ url: a.url, taskId: a.task_id })),
  },
  {
    name: "browser_snapshot",
    description:
      "Re-read the current page and return an accessibility-tree snapshot. Required after the page changes (clicks, navigation, dynamic content) before referring to elements again. Set full=true for a verbose snapshot including headings and paragraphs.",
    inputSchema: SnapshotSchema,
    handler: adapt(SnapshotSchema, (a) => browserSnapshot({ full: a.full, taskId: a.task_id })),
  },
  {
    name: "browser_click",
    description:
      'Click an element identified by a ref like "@e5" from the latest snapshot. The ref must come from a current snapshot — if the page has changed, call browser_snapshot first.',
    inputSchema: ClickSchema,
    handler: adapt(ClickSchema, (a) => browserClick({ ref: a.ref, taskId: a.task_id })),
  },
  {
    name: "browser_type",
    description:
      'Type text into an input or textarea element identified by a ref like "@e3". Clears any existing value first. Set submit=true to press Enter after typing.',
    inputSchema: TypeSchema,
    handler: adapt(TypeSchema, (a) =>
      browserType({ ref: a.ref, text: a.text, submit: a.submit, taskId: a.task_id }),
    ),
  },
  {
    name: "browser_scroll",
    description: 'Scroll the viewport up or down by a number of pixels (default 600).',
    inputSchema: ScrollSchema,
    handler: adapt(ScrollSchema, (a) =>
      browserScroll({ direction: a.direction, pixels: a.pixels, taskId: a.task_id }),
    ),
  },
  {
    name: "browser_back",
    description: "Navigate back one step in browser history.",
    inputSchema: BackSchema,
    handler: adapt(BackSchema, (a) => browserBack({ taskId: a.task_id })),
  },
  {
    name: "browser_press",
    description: 'Press a keyboard key (Playwright format), e.g. "Enter", "Tab", "Escape", "Control+a".',
    inputSchema: PressSchema,
    handler: adapt(PressSchema, (a) => browserPress({ key: a.key, taskId: a.task_id })),
  },
  {
    name: "browser_console",
    description:
      "Read accumulated browser console messages and JavaScript errors since the last call (or session start). Set clear=true to empty the buffers afterward. If expression is provided, evaluate it in the page context and return the result instead.",
    inputSchema: ConsoleSchema,
    handler: adapt(ConsoleSchema, (a) =>
      browserConsole({ clear: a.clear, expression: a.expression, taskId: a.task_id }),
    ),
  },
  {
    name: "browser_get_images",
    description: "Return a list of <img> elements on the current page with src/alt/dimensions. Skips data: URLs.",
    inputSchema: GetImagesSchema,
    handler: adapt(GetImagesSchema, (a) => browserGetImages({ taskId: a.task_id })),
  },
  {
    name: "browser_vision",
    description:
      "Take a full-page screenshot of the current page and ask a Claude vision model a question about it. Useful for understanding visual layout, captchas, and content not exposed in the accessibility tree. Requires ANTHROPIC_API_KEY.",
    inputSchema: VisionSchema,
    handler: adapt(VisionSchema, (a) =>
      browserVision({
        question: a.question,
        annotate: a.annotate,
        model: a.model,
        taskId: a.task_id,
      }),
    ),
  },
];

export function findSpec(name: string): ToolSpec | undefined {
  return TOOL_SPECS.find((s) => s.name === name);
}

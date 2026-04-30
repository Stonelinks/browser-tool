import type {
  BrowserContext,
  Page,
  ConsoleMessage as PWConsoleMessage,
} from "playwright-core";
import type { ConsoleMessage, JsError } from "../types.js";

export class Session {
  taskId: string;
  context: BrowserContext;
  page: Page;
  consoleBuffer: ConsoleMessage[] = [];
  errorBuffer: JsError[] = [];
  lastActivityAt: number;
  lastSnapshotAt: number = 0;
  closed: boolean = false;

  constructor(taskId: string, context: BrowserContext, page: Page) {
    this.taskId = taskId;
    this.context = context;
    this.page = page;
    this.lastActivityAt = Date.now();
    this.attachListeners();
  }

  private attachListeners(): void {
    this.context.on("page", (page) => {
      this.attachPageListeners(page);
    });
    this.attachPageListeners(this.page);
  }

  private attachPageListeners(page: Page): void {
    page.on("console", (msg: PWConsoleMessage) => {
      if (this.consoleBuffer.length >= 1000) this.consoleBuffer.shift();
      const loc = msg.location();
      this.consoleBuffer.push({
        type: msg.type(),
        text: msg.text(),
        location: loc.url
          ? `${loc.url}:${loc.lineNumber}:${loc.columnNumber}`
          : undefined,
        timestamp: Date.now(),
      });
    });
    page.on("pageerror", (err: Error) => {
      if (this.errorBuffer.length >= 500) this.errorBuffer.shift();
      this.errorBuffer.push({
        message: err.message,
        stack: err.stack,
        timestamp: Date.now(),
      });
    });
  }

  touch(): void {
    this.lastActivityAt = Date.now();
  }

  clearBuffers(): void {
    this.consoleBuffer = [];
    this.errorBuffer = [];
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.context.close();
    } catch {
      // ignore
    }
  }
}

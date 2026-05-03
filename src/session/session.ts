import type {
  BrowserContext,
  Page,
  ConsoleMessage as PWConsoleMessage,
  Response as PWResponse,
} from "playwright-core";
import type { ConsoleMessage, JsError, NetworkRequest } from "../types.js";

export class Session {
  taskId: string;
  context: BrowserContext;
  page: Page;
  consoleBuffer: ConsoleMessage[] = [];
  errorBuffer: JsError[] = [];
  networkBuffer: NetworkRequest[] = [];
  lastActivityAt: number;
  lastSnapshotAt: number = 0;
  closed: boolean = false;

  private static readonly CONSOLE_BUFFER_LIMIT = 1000;
  private static readonly ERROR_BUFFER_LIMIT = 500;
  private static readonly NETWORK_BUFFER_LIMIT = 500;
  private static readonly BODY_MAX_SIZE = 100_000;
  // Content-type prefixes for which we capture response bodies
  private static readonly TEXT_CONTENT_TYPES = [
    "text/",
    "application/json",
    "application/xml",
    "application/javascript",
    "application/x-javascript",
    "application/xhtml+xml",
    "+xml",
    "+json",
  ];

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
      if (this.consoleBuffer.length >= Session.CONSOLE_BUFFER_LIMIT) this.consoleBuffer.shift();
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
      if (this.errorBuffer.length >= Session.ERROR_BUFFER_LIMIT) this.errorBuffer.shift();
      this.errorBuffer.push({
        message: err.message,
        stack: err.stack,
        timestamp: Date.now(),
      });
    });
    page.on("response", (response: PWResponse) => {
      this.captureNetworkEntry(response).catch(() => {
        // Silently ignore body capture failures
      });
    });
  }

  private async captureNetworkEntry(response: PWResponse): Promise<void> {
    if (this.networkBuffer.length >= Session.NETWORK_BUFFER_LIMIT) this.networkBuffer.shift();

    const request = response.request();
    const contentType = response.headers()["content-type"] ?? "";
    const url = response.url();

    // Skip data: URLs
    if (url.startsWith("data:")) return;

    const entry: NetworkRequest = {
      url,
      method: request.method(),
      status: response.status(),
      content_type: contentType,
      size: 0,
      duration_ms: this.computeDuration(request),
      resource_type: request.resourceType(),
      request_headers: request.headers() as Record<string, string>,
      response_headers: response.headers() as Record<string, string>,
      timestamp: Date.now(),
    };

    // Capture body for text-based content types
    if (Session.isTextContentType(contentType)) {
      try {
        const body = await response.text();
        entry.size = body.length;
        if (body.length > Session.BODY_MAX_SIZE) {
          entry.body = body.slice(0, Session.BODY_MAX_SIZE);
          entry.body_truncated = true;
        } else {
          entry.body = body;
          entry.body_truncated = false;
        }
      } catch {
        // Body not available (e.g. already consumed, or not readable)
      }
    }

    this.networkBuffer.push(entry);
  }

  private computeDuration(request: import("playwright-core").Request): number {
    try {
      const timing = request.timing();
      return timing.responseEnd - timing.requestStart;
    } catch {
      return -1;
    }
  }

  private static isTextContentType(contentType: string): boolean {
    const lower = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
    return Session.TEXT_CONTENT_TYPES.some((prefix) => lower.includes(prefix));
  }

  touch(): void {
    this.lastActivityAt = Date.now();
  }

  clearBuffers(): void {
    this.consoleBuffer = [];
    this.errorBuffer = [];
    this.networkBuffer = [];
  }

  clearNetworkBuffer(): void {
    this.networkBuffer = [];
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

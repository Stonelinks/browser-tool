import { chromium, type Browser } from "playwright-core";
import { Session } from "./session.js";
import { getConfig } from "../config.js";
import { logDebug } from "../logger.js";

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => resolve(), ms);
  });
  return Promise.race([
    p.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    timeout,
  ]);
}

export class SessionManager {
  private static instance: SessionManager | null = null;
  private browser: Browser | null = null;
  private sessions: Map<string, Session> = new Map();
  private launchPromise: Promise<Browser> | null = null;
  private reaperHandle: ReturnType<typeof setInterval> | null = null;
  private creating: Map<string, Promise<Session>> = new Map();

  static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  static resetForTesting(): void {
    SessionManager.instance = null;
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) return this.browser;
    if (!this.launchPromise) {
      const cfg = getConfig();
      logDebug("launching chromium, headless=", cfg.headless);
      this.launchPromise = chromium.launch({
        headless: cfg.headless,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
    }
    this.browser = await this.launchPromise;
    this.launchPromise = null;
    return this.browser;
  }

  async getOrCreate(taskId: string): Promise<Session> {
    const existing = this.sessions.get(taskId);
    if (existing && !existing.closed) {
      existing.touch();
      return existing;
    }
    const inflight = this.creating.get(taskId);
    if (inflight) return inflight;
    const promise = this.create(taskId);
    this.creating.set(taskId, promise);
    try {
      return await promise;
    } finally {
      this.creating.delete(taskId);
    }
  }

  private async create(taskId: string): Promise<Session> {
    const browser = await this.ensureBrowser();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      bypassCSP: false,
    });
    const page = await context.newPage();
    const session = new Session(taskId, context, page);
    this.sessions.set(taskId, session);
    this.startIdleReaper();
    logDebug("created session", taskId);
    return session;
  }

  get(taskId: string): Session | undefined {
    return this.sessions.get(taskId);
  }

  async close(taskId: string): Promise<void> {
    const session = this.sessions.get(taskId);
    if (!session) return;
    this.sessions.delete(taskId);
    await session.close();
    logDebug("closed session", taskId);
  }

  async closeAllSessions(): Promise<void> {
    const sessions = Array.from(this.sessions.values());
    this.sessions.clear();
    await Promise.allSettled(sessions.map((s) => withTimeout(s.close(), 5000)));
  }

  async closeAll(): Promise<void> {
    this.stopIdleReaper();
    await this.closeAllSessions();
    if (this.browser && this.browser.isConnected()) {
      try {
        await withTimeout(this.browser.close(), 5000);
      } catch {
        // ignore
      }
    }
    this.browser = null;
    this.launchPromise = null;
  }

  startIdleReaper(): void {
    if (this.reaperHandle) return;
    const cfg = getConfig();
    this.reaperHandle = setInterval(() => {
      void this.reapIdle();
    }, cfg.reaperIntervalMs);
    if (typeof this.reaperHandle.unref === "function")
      this.reaperHandle.unref();
  }

  stopIdleReaper(): void {
    if (this.reaperHandle) {
      clearInterval(this.reaperHandle);
      this.reaperHandle = null;
    }
  }

  private async reapIdle(): Promise<void> {
    const cfg = getConfig();
    const now = Date.now();
    const stale: string[] = [];
    for (const [taskId, session] of this.sessions) {
      if (now - session.lastActivityAt > cfg.inactivityTimeoutMs) {
        stale.push(taskId);
      }
    }
    for (const taskId of stale) {
      logDebug("reaping idle session", taskId);
      await this.close(taskId);
    }
  }

  size(): number {
    return this.sessions.size;
  }
}

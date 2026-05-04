import { chromium, type Browser } from "playwright-core";
import { Session } from "./session.js";
import { getConfig } from "../config.js";
import { logDebug } from "../logger.js";

/**
 * Promise-based mutex using a chaining pattern.
 * Calls to `runExclusive` are serialized per mutex instance.
 */
export class Mutex {
  private chain: Promise<void> = Promise.resolve();

  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.chain;
    let resolve!: () => void;
    this.chain = new Promise<void>((r) => {
      resolve = r;
    });
    return prev.then(() => fn()).finally(resolve);
  }
}

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
  private mutexes: Map<string, Mutex> = new Map();
  private closing: Set<string> = new Set();

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
    // Re-check after any in-flight creation completes
    const existing = this.sessions.get(taskId);
    if (existing && !existing.closed) {
      existing.touch();
      return existing;
    }
    const inflight = this.creating.get(taskId);
    if (inflight) {
      // Wait for the in-flight creation, then re-check the map
      await inflight;
      const afterInflight = this.sessions.get(taskId);
      if (afterInflight && !afterInflight.closed) {
        afterInflight.touch();
        return afterInflight;
      }
    }
    // Enforce max sessions limit (reuse of existing taskId bypasses this)
    const cfg = getConfig();
    if (this.sessions.size >= cfg.maxSessions) {
      throw new Error(
        `Session limit reached (${cfg.maxSessions}). Close an existing session or increase BROWSER_MAX_SESSIONS.`,
      );
    }
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
    if (this.closing.has(taskId)) return;
    const session = this.sessions.get(taskId);
    if (!session) return;
    this.closing.add(taskId);
    this.sessions.delete(taskId);
    try {
      await session.close();
      logDebug("closed session", taskId);
    } finally {
      this.closing.delete(taskId);
    }
  }

  async closeAllSessions(): Promise<void> {
    const tasks = Array.from(this.sessions.keys()).filter(
      (id) => !this.closing.has(id),
    );
    const sessions = tasks
      .map((id) => this.sessions.get(id)!)
      .filter(Boolean);
    for (const id of tasks) {
      this.closing.add(id);
      this.sessions.delete(id);
    }
    await Promise.allSettled(
      sessions.map((s) =>
        withTimeout(
          s.close().finally(() => this.closing.delete(s.taskId)),
          5000,
        ),
      ),
    );
  }

  /**
   * Run `fn` exclusively for the given taskId — concurrent calls with the
   * same taskId are serialized via a promise chain. Different taskIds run
   * in parallel.
   */
  runExclusive<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
    let mutex = this.mutexes.get(taskId);
    if (!mutex) {
      mutex = new Mutex();
      this.mutexes.set(taskId, mutex);
    }
    return mutex.runExclusive(fn);
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

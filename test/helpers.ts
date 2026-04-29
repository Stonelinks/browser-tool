import { afterAll, afterEach, beforeAll } from "bun:test";
import { SessionManager } from "../src/index.js";
import { startFixtureServer, type FixtureServer } from "./fixtures/server.js";

export function useFixtureServer(): { url: () => string } {
  // IMPORTANT: each call captures its own state in this closure. Do NOT use
  // a module-level variable here — bun test runs files in parallel and a
  // shared variable would be overwritten across files.
  let fixtures: FixtureServer | null = null;

  beforeAll(async () => {
    fixtures = await startFixtureServer();
  });
  afterAll(async () => {
    await SessionManager.getInstance().closeAll();
    if (fixtures) await fixtures.stop();
    fixtures = null;
  });
  afterEach(async () => {
    await SessionManager.getInstance().closeAllSessions();
  });
  return {
    url: () => {
      if (!fixtures) throw new Error("fixture server not started");
      return fixtures.url;
    },
  };
}

export function findFirstRef(snapshot: string, pattern: RegExp): string | null {
  for (const line of snapshot.split("\n")) {
    if (pattern.test(line)) {
      const refMatch = line.match(/\[ref @(e\d+)\]/);
      if (refMatch) return `@${refMatch[1]}`;
    }
  }
  return null;
}

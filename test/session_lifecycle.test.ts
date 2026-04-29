import { test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { browserNavigate, SessionManager, resetConfig } from "../src/index.js";
import { startFixtureServer, type FixtureServer } from "./fixtures/server.js";

let fixtures: FixtureServer | null = null;

beforeAll(async () => {
  fixtures = await startFixtureServer();
});

afterAll(async () => {
  await SessionManager.getInstance().closeAll();
  if (fixtures) await fixtures.stop();
  delete process.env.BROWSER_INACTIVITY_TIMEOUT;
  delete process.env.BROWSER_REAPER_INTERVAL;
  resetConfig();
});

afterEach(async () => {
  await SessionManager.getInstance().closeAll();
  delete process.env.BROWSER_INACTIVITY_TIMEOUT;
  delete process.env.BROWSER_REAPER_INTERVAL;
  resetConfig();
});

test("two task IDs maintain isolated browser contexts", async () => {
  const url = `${fixtures!.url}/form.html`;
  const aboutUrl = `${fixtures!.url}/about`;
  const a = await browserNavigate({ url, taskId: "iso-a" });
  const b = await browserNavigate({ url: aboutUrl, taskId: "iso-b" });
  expect(a.success).toBe(true);
  expect(b.success).toBe(true);

  const sessionA = SessionManager.getInstance().get("iso-a");
  const sessionB = SessionManager.getInstance().get("iso-b");
  expect(sessionA).toBeDefined();
  expect(sessionB).toBeDefined();
  expect(sessionA!.page.url()).toContain("/form.html");
  expect(sessionB!.page.url()).toContain("/about");
  // Different contexts.
  expect(sessionA!.context).not.toBe(sessionB!.context);
});

test("idle reaper closes sessions older than the timeout", async () => {
  process.env.BROWSER_INACTIVITY_TIMEOUT = "1";
  process.env.BROWSER_REAPER_INTERVAL = "1";
  resetConfig();
  const url = `${fixtures!.url}/form.html`;
  await browserNavigate({ url, taskId: "reap-1" });
  expect(SessionManager.getInstance().get("reap-1")).toBeDefined();
  // Wait > timeout + reaper interval to ensure reap fires.
  await new Promise((r) => setTimeout(r, 2500));
  expect(SessionManager.getInstance().get("reap-1")).toBeUndefined();
}, 15000);

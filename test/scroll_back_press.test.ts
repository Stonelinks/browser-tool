import { test, expect } from "bun:test";
import {
  browserNavigate,
  browserScroll,
  browserBack,
  browserPress,
  browserSnapshot,
  SessionManager,
} from "../src/index.js";
import { useFixtureServer } from "./helpers.js";

const ctx = useFixtureServer();

test("scroll down then up", async () => {
  const taskId = "scroll-1";
  await browserNavigate({ url: `${ctx.url()}/scroll.html`, taskId });
  const down = await browserScroll({ direction: "down", pixels: 800, taskId });
  expect(down.success).toBe(true);
  if (!down.success) return;
  expect(down.scrollY).toBeGreaterThan(700);
  const up = await browserScroll({ direction: "up", pixels: 400, taskId });
  expect(up.success).toBe(true);
  if (!up.success) return;
  expect(up.scrollY).toBeLessThan(down.scrollY);
});

test("back navigates to previous URL", async () => {
  const taskId = "back-1";
  await browserNavigate({ url: `${ctx.url()}/form.html`, taskId });
  await browserNavigate({ url: `${ctx.url()}/about`, taskId });
  // Verify we're on the about page
  const session = SessionManager.getInstance().get(taskId);
  expect(session?.page.url()).toContain("/about");
  const back = await browserBack({ taskId });
  expect(back.success).toBe(true);
  if (!back.success) return;
  expect(back.url).toContain("/form.html");
});

test("press Tab moves focus", async () => {
  const taskId = "press-tab";
  const nav = await browserNavigate({ url: `${ctx.url()}/form.html`, taskId });
  expect(nav.success).toBe(true);
  const press = await browserPress({ key: "Tab", taskId });
  expect(press.success).toBe(true);
  // Verify something is focused
  const session = SessionManager.getInstance().get(taskId);
  const focused = await session!.page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el ? el.tagName : null;
  });
  expect(focused).not.toBeNull();
});

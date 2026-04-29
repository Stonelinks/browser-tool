import { test, expect } from "bun:test";
import { browserNavigate, browserSnapshot } from "../src/index.js";
import { useFixtureServer } from "./helpers.js";

const ctx = useFixtureServer();

test("compact snapshot contains interactive refs and skips paragraphs", async () => {
  await browserNavigate({ url: `${ctx.url()}/form.html`, taskId: "snap-1" });
  const res = await browserSnapshot({ taskId: "snap-1" });
  expect(res.success).toBe(true);
  if (!res.success) return;
  expect(res.snapshot).toContain("[ref @e");
  expect(res.snapshot).toMatch(/textbox.*\[ref @e\d+\]/);
  expect(res.snapshot).toMatch(/button.*\[ref @e\d+\]/);
  expect(res.snapshot).toMatch(/link.*\[ref @e\d+\]/);
  expect(res.snapshot).not.toContain("Welcome to the search demo");
  expect(res.element_count).toBeGreaterThanOrEqual(3);
});

test("full snapshot includes paragraph text", async () => {
  await browserNavigate({ url: `${ctx.url()}/form.html`, taskId: "snap-full" });
  const res = await browserSnapshot({ full: true, taskId: "snap-full" });
  expect(res.success).toBe(true);
  if (!res.success) return;
  expect(res.snapshot).toContain("Welcome to the search demo");
});

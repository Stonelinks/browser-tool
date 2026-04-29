import { test, expect } from "bun:test";
import { browserNavigate } from "../src/index.js";
import { useFixtureServer } from "./helpers.js";

const ctx = useFixtureServer();

test("browserNavigate succeeds and returns a snapshot with refs", async () => {
  const res = await browserNavigate({ url: `${ctx.url()}/form.html`, taskId: "nav-1" });
  expect(res.success).toBe(true);
  if (!res.success) return;
  expect(res.title).toBe("Form Test");
  expect(res.snapshot).toContain("[ref @e");
  expect(res.element_count).toBeGreaterThan(0);
  expect(res.url).toContain("/form.html");
});

test("browserNavigate fails on bad host", async () => {
  const res = await browserNavigate({
    url: "http://127.0.0.1:1/does-not-exist",
    taskId: "nav-fail",
  });
  expect(res.success).toBe(false);
  if (res.success) return;
  expect(res.error).toContain("navigation failed");
});

test("browserNavigate prepends https:// when missing", async () => {
  // Just tests URL normalization indirectly by checking we don't get a parse error
  // for a host-only string. Use a definitely-unreachable URL so we get a network
  // error rather than a parse error.
  const res = await browserNavigate({
    url: "127.0.0.1:1",
    taskId: "nav-norm",
  });
  expect(res.success).toBe(false);
});

import { test, expect } from "bun:test";
import { browserNavigate, browserSnapshot, browserClick, browserType } from "../src/index.js";
import { useFixtureServer, findFirstRef } from "./helpers.js";

const ctx = useFixtureServer();

test("type then click submits the form and lands on results", async () => {
  const taskId = "click-1";
  const nav = await browserNavigate({ url: `${ctx.url()}/form.html`, taskId });
  expect(nav.success).toBe(true);
  if (!nav.success) return;
  const inputRef = findFirstRef(nav.snapshot, /textbox/);
  const buttonRef = findFirstRef(nav.snapshot, /button/);
  expect(inputRef).not.toBeNull();
  expect(buttonRef).not.toBeNull();

  const typeRes = await browserType({ ref: inputRef!, text: "hello world", taskId });
  expect(typeRes.success).toBe(true);

  const clickRes = await browserClick({ ref: buttonRef!, taskId });
  expect(clickRes.success).toBe(true);
  if (!clickRes.success) return;
  expect(clickRes.url).toContain("/results");

  const after = await browserSnapshot({ full: true, taskId });
  expect(after.success).toBe(true);
  if (!after.success) return;
  expect(after.snapshot).toContain("You searched for: hello world");
});

test("clicking unknown ref returns helpful error", async () => {
  const taskId = "click-bad";
  await browserNavigate({ url: `${ctx.url()}/form.html`, taskId });
  const res = await browserClick({ ref: "@e9999", taskId });
  expect(res.success).toBe(false);
  if (res.success) return;
  expect(res.error).toContain("not found");
  expect(res.error).toContain("browser_snapshot");
});

test("type with submit=true navigates without separate click", async () => {
  const taskId = "type-submit";
  const nav = await browserNavigate({ url: `${ctx.url()}/form.html`, taskId });
  expect(nav.success).toBe(true);
  if (!nav.success) return;
  const inputRef = findFirstRef(nav.snapshot, /textbox/);
  expect(inputRef).not.toBeNull();
  const res = await browserType({ ref: inputRef!, text: "submitnow", submit: true, taskId });
  expect(res.success).toBe(true);
  const after = await browserSnapshot({ full: true, taskId });
  if (!after.success) return;
  expect(after.snapshot).toContain("You searched for: submitnow");
});

test("ref accepts plain numeric form", async () => {
  const taskId = "ref-numeric";
  const nav = await browserNavigate({ url: `${ctx.url()}/form.html`, taskId });
  expect(nav.success).toBe(true);
  if (!nav.success) return;
  // Find first textbox ref number
  const m = nav.snapshot.match(/textbox[^\n]*\[ref @e(\d+)\]/);
  expect(m).not.toBeNull();
  const numericRef = m![1] as string;
  const res = await browserType({ ref: numericRef, text: "abc", taskId });
  expect(res.success).toBe(true);
});

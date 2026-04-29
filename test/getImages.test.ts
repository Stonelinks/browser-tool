import { test, expect } from "bun:test";
import { browserNavigate, browserGetImages } from "../src/index.js";
import { useFixtureServer } from "./helpers.js";

const ctx = useFixtureServer();

test("get_images returns http(s) images and skips data: URLs", async () => {
  const taskId = "imgs-1";
  await browserNavigate({ url: `${ctx.url()}/images.html`, taskId });
  const res = await browserGetImages({ taskId });
  expect(res.success).toBe(true);
  if (!res.success) return;
  expect(res.count).toBe(2);
  const alts = res.images.map((i) => i.alt).sort();
  expect(alts).toEqual(["A cat", "A dog"]);
  for (const img of res.images) {
    expect(img.src).toMatch(/^https?:\/\//);
    expect(img.src).not.toMatch(/^data:/);
  }
});

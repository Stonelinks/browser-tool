import { test, expect, mock, beforeEach } from "bun:test";

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

test("vision returns graceful error when ANTHROPIC_API_KEY is missing", async () => {
  // Use a fresh import to avoid singletons holding old config.
  const { browserNavigate, browserVision, SessionManager, resetConfig } = await import("../src/index.js");
  const { startFixtureServer } = await import("./fixtures/server.js");
  resetConfig();
  const fixtures = await startFixtureServer();
  try {
    const taskId = "vision-no-key";
    await browserNavigate({ url: `${fixtures.url}/form.html`, taskId });
    delete process.env.ANTHROPIC_API_KEY;
    const res = await browserVision({ question: "what is here?", taskId });
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toContain("ANTHROPIC_API_KEY");
  } finally {
    await SessionManager.getInstance().closeAll();
    await fixtures.stop();
  }
}, 30000);

test("vision succeeds with mocked Anthropic client", async () => {
  // Replace the analyzeScreenshot module with a stub before importing actions.
  await mock.module("../src/vision/anthropic.js", () => ({
    analyzeScreenshot: async () => ({
      success: true,
      analysis: "I see a search form with a query box and a Search button.",
      model: "mock-vision-1",
    }),
  }));
  process.env.ANTHROPIC_API_KEY = "sk-ant-mock";
  const { browserNavigate, browserVision, SessionManager } = await import("../src/index.js");
  const { startFixtureServer } = await import("./fixtures/server.js");
  const fixtures = await startFixtureServer();
  try {
    const taskId = "vision-mock";
    await browserNavigate({ url: `${fixtures.url}/form.html`, taskId });
    const res = await browserVision({ question: "what is here?", taskId });
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.analysis).toContain("search form");
    expect(res.model).toBe("mock-vision-1");
    expect(res.screenshot_path).toMatch(/browser_screenshot_.*\.png$/);
  } finally {
    await SessionManager.getInstance().closeAll();
    await fixtures.stop();
    mock.restore();
  }
}, 30000);

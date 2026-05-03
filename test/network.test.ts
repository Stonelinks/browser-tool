import { test, expect } from "bun:test";
import { browserNavigate, browserNetwork } from "../src/index.js";
import { useFixtureServer } from "./helpers.js";

const ctx = useFixtureServer();

test("network captures requests with status, body, and headers", async () => {
  const taskId = "network-1";
  await browserNavigate({ url: `${ctx.url()}/network.html`, taskId });
  // Wait for fetch/XHR requests to complete
  await new Promise((r) => setTimeout(r, 1000));

  const res = await browserNetwork({ taskId });
  expect(res.success).toBe(true);
  if (!res.success) return;

  if ("requests" in res) {
    // Should have captured the API calls plus the document itself
    const apiRequests = res.requests.filter((r) =>
      r.url.includes("/api/"),
    );
    expect(apiRequests.length).toBeGreaterThanOrEqual(3);

    // Check JSON endpoint
    const jsonReq = apiRequests.find((r) =>
      r.url.includes("/api/json-endpoint"),
    );
    expect(jsonReq).toBeDefined();
    expect(jsonReq!.status).toBe(200);
    expect(jsonReq!.method).toBe("GET");
    expect(jsonReq!.content_type).toContain("application/json");
    expect(jsonReq!.body).toContain("hello");

    // Check text endpoint
    const textReq = apiRequests.find((r) =>
      r.url.includes("/api/text-endpoint"),
    );
    expect(textReq).toBeDefined();
    expect(textReq!.body).toBe("plain text response");

    // Check 404
    const notFoundReq = apiRequests.find((r) =>
      r.url.includes("/api/not-found"),
    );
    expect(notFoundReq).toBeDefined();
    expect(notFoundReq!.status).toBe(404);

    // Check POST
    const postReq = apiRequests.find((r) =>
      r.url.includes("/api/post-endpoint"),
    );
    expect(postReq).toBeDefined();
    expect(postReq!.method).toBe("POST");
  } else {
    throw new Error("expected NetworkResult");
  }
});

test("network filtering by resource_type", async () => {
  const taskId = "network-filter-type";
  await browserNavigate({ url: `${ctx.url()}/network.html`, taskId });
  await new Promise((r) => setTimeout(r, 1000));

  const res = await browserNetwork({
    filter: { resource_type: "fetch" },
    taskId,
  });
  expect(res.success).toBe(true);
  if (!res.success) return;
  if ("requests" in res) {
    // All returned requests should be fetch type
    for (const r of res.requests) {
      expect(r.resource_type.toLowerCase()).toBe("fetch");
    }
  }
});

test("network filtering by url_pattern", async () => {
  const taskId = "network-filter-url";
  await browserNavigate({ url: `${ctx.url()}/network.html`, taskId });
  await new Promise((r) => setTimeout(r, 1000));

  const res = await browserNetwork({
    filter: { url_pattern: "/api/json" },
    taskId,
  });
  expect(res.success).toBe(true);
  if (!res.success) return;
  if ("requests" in res) {
    expect(res.requests.length).toBeGreaterThanOrEqual(1);
    for (const r of res.requests) {
      expect(r.url).toContain("/api/json");
    }
  }
});

test("network filtering by status_code", async () => {
  const taskId = "network-filter-status";
  await browserNavigate({ url: `${ctx.url()}/network.html`, taskId });
  await new Promise((r) => setTimeout(r, 1000));

  const res = await browserNetwork({
    filter: { status_code: 404 },
    taskId,
  });
  expect(res.success).toBe(true);
  if (!res.success) return;
  if ("requests" in res) {
    expect(res.requests.length).toBeGreaterThanOrEqual(1);
    for (const r of res.requests) {
      expect(r.status).toBe(404);
    }
  }
});

test("network clear empties the buffer", async () => {
  const taskId = "network-clear";
  await browserNavigate({ url: `${ctx.url()}/network.html`, taskId });
  await new Promise((r) => setTimeout(r, 1000));

  const before = await browserNetwork({ taskId });
  expect(before.success).toBe(true);
  if (!before.success) return;
  if (!("requests" in before)) return;
  expect(before.requests.length).toBeGreaterThan(0);

  // Clear and check
  const cleared = await browserNetwork({ clear: true, taskId });
  expect(cleared.success).toBe(true);

  const after = await browserNetwork({ taskId });
  if (after.success && "requests" in after) {
    expect(after.requests.length).toBeLessThan(before.requests.length);
  }
});

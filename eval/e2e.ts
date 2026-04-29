#!/usr/bin/env bun
import {
  browserNavigate,
  browserSnapshot,
  browserType,
  browserClick,
  browserConsole,
  browserVision,
  SessionManager,
} from "../src/index.js";
import { startFixtureServer } from "../test/fixtures/server.js";

interface StepResult {
  ok: boolean;
  detail: string;
}

const TASK_ID = "eval";
const steps: Array<{ name: string; run: () => Promise<StepResult> }> = [];
const recorded: Array<{ name: string; result: StepResult }> = [];

let snapshotForRefs = "";

steps.push({
  name: "1. start fixture server",
  run: async () => {
    return { ok: true, detail: "deferred to context" };
  },
});

const fixtures = await startFixtureServer();

const url = `${fixtures.url}/form.html`;

steps.length = 0; // reset; we set up server above

steps.push({
  name: "1. navigate",
  run: async () => {
    const res = await browserNavigate({ url, taskId: TASK_ID });
    if (!res.success) return { ok: false, detail: `navigate failed: ${res.error}` };
    if (!res.snapshot.includes("[ref @e")) {
      return { ok: false, detail: "snapshot missing @e refs" };
    }
    snapshotForRefs = res.snapshot;
    return { ok: true, detail: `title=${res.title}, refs=${res.element_count}` };
  },
});

steps.push({
  name: "2. snapshot extracts input + button refs",
  run: async () => {
    const inputMatch = snapshotForRefs.match(/textbox[^\n]*\[ref @(e\d+)\]/);
    const buttonMatch = snapshotForRefs.match(/button[^\n]*\[ref @(e\d+)\]/);
    if (!inputMatch || !buttonMatch) {
      return { ok: false, detail: "could not find input or button ref" };
    }
    return {
      ok: true,
      detail: `input=@${inputMatch[1]}, button=@${buttonMatch[1]}`,
    };
  },
});

steps.push({
  name: "3. type into input",
  run: async () => {
    const m = snapshotForRefs.match(/textbox[^\n]*\[ref @(e\d+)\]/);
    if (!m) return { ok: false, detail: "no input ref" };
    const res = await browserType({ ref: `@${m[1]}`, text: "hello", taskId: TASK_ID });
    if (!res.success) return { ok: false, detail: `type failed: ${res.error}` };
    return { ok: true, detail: `typed "hello"` };
  },
});

steps.push({
  name: "4. click submit",
  run: async () => {
    const m = snapshotForRefs.match(/button[^\n]*\[ref @(e\d+)\]/);
    if (!m) return { ok: false, detail: "no button ref" };
    const res = await browserClick({ ref: `@${m[1]}`, taskId: TASK_ID });
    if (!res.success) return { ok: false, detail: `click failed: ${res.error}` };
    if (!res.url.includes("/results")) {
      return { ok: false, detail: `expected /results, got ${res.url}` };
    }
    return { ok: true, detail: `landed on ${res.url}` };
  },
});

steps.push({
  name: "5. snapshot shows results",
  run: async () => {
    const res = await browserSnapshot({ full: true, taskId: TASK_ID });
    if (!res.success) return { ok: false, detail: `snapshot failed: ${res.error}` };
    if (!res.snapshot.includes("You searched for: hello")) {
      return { ok: false, detail: `expected results text, got: ${res.snapshot.slice(0, 200)}` };
    }
    return { ok: true, detail: "results page contains 'hello'" };
  },
});

steps.push({
  name: "6. console reports no errors",
  run: async () => {
    const res = await browserConsole({ taskId: TASK_ID });
    if (!res.success) return { ok: false, detail: `console failed: ${res.error}` };
    if ("js_errors" in res) {
      if (res.js_errors.length > 0) {
        return {
          ok: false,
          detail: `js errors present: ${res.js_errors.map((e) => e.message).join(", ")}`,
        };
      }
      return { ok: true, detail: `${res.total_messages} messages, 0 errors` };
    }
    return { ok: false, detail: "unexpected eval-shape result" };
  },
});

steps.push({
  name: "7. console eval expression",
  run: async () => {
    const res = await browserConsole({ expression: "document.title", taskId: TASK_ID });
    if (!res.success) return { ok: false, detail: `eval failed: ${res.error}` };
    if ("result" in res) {
      if (res.result !== "Results") {
        return { ok: false, detail: `expected title 'Results', got ${JSON.stringify(res.result)}` };
      }
      return { ok: true, detail: `title='Results'` };
    }
    return { ok: false, detail: "unexpected buffer-shape result" };
  },
});

steps.push({
  name: "8. vision (live API call)",
  run: async () => {
    const res = await browserVision({
      question:
        "Look at the page. Does it contain text indicating a search was performed for 'hello'? Reply 'yes' or 'no' followed by a one-sentence explanation.",
      taskId: TASK_ID,
    });
    if (!res.success) return { ok: false, detail: `vision failed: ${res.error}` };
    const lower = res.analysis.toLowerCase();
    if (!lower.includes("hello") && !lower.includes("yes")) {
      return {
        ok: false,
        detail: `analysis did not affirm content. Got: ${res.analysis.slice(0, 200)}`,
      };
    }
    return {
      ok: true,
      detail: `model=${res.model}; analysis=${res.analysis.slice(0, 120).replace(/\n/g, " ")}…`,
    };
  },
});

let allOk = true;
for (const step of steps) {
  process.stdout.write(`▶ ${step.name}…\n`);
  let result: StepResult;
  try {
    result = await step.run();
  } catch (err) {
    result = { ok: false, detail: `threw: ${err instanceof Error ? err.message : String(err)}` };
  }
  recorded.push({ name: step.name, result });
  if (!result.ok) allOk = false;
  process.stdout.write(`  ${result.ok ? "✓" : "✗"} ${result.detail}\n`);
}

await SessionManager.getInstance().closeAll();
await fixtures.stop();

const passed = recorded.filter((r) => r.result.ok).length;
const total = recorded.length;
process.stdout.write("\n");
if (allOk) {
  process.stdout.write(`EVAL PASS (${passed}/${total} steps)\n`);
  process.exit(0);
} else {
  process.stdout.write(`EVAL FAIL (${passed}/${total} steps)\n`);
  for (const r of recorded) {
    if (!r.result.ok) process.stdout.write(`  - ${r.name}: ${r.result.detail}\n`);
  }
  process.exit(1);
}

import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { withSession, failure, errorMessage } from "./_helpers.js";
import { analyzeScreenshot } from "../vision/anthropic.js";
import { getConfig } from "../config.js";
import { logDebug } from "../logger.js";
import type { ActionResult, VisionResult } from "../types.js";

export interface VisionInput {
  question: string;
  annotate?: boolean;
  model?: string;
  taskId?: string;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function pruneOldScreenshots(dir: string): Promise<void> {
  try {
    const entries = await readdir(dir);
    const now = Date.now();
    await Promise.all(
      entries.map(async (name) => {
        if (!name.startsWith("browser_screenshot_") || !name.endsWith(".png"))
          return;
        const full = join(dir, name);
        try {
          const s = await stat(full);
          if (now - s.mtimeMs > ONE_DAY_MS) await unlink(full);
        } catch {
          // ignore
        }
      }),
    );
  } catch {
    // dir may not exist yet
  }
}

async function injectAnnotations(
  page: import("playwright-core").Page,
): Promise<void> {
  await page.evaluate(() => {
    const existing = document.getElementById("__bt_annotation_layer__");
    if (existing) existing.remove();
    const layer = document.createElement("div");
    layer.id = "__bt_annotation_layer__";
    layer.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:2147483647;font-family:Arial,sans-serif;";
    const elements = document.querySelectorAll<HTMLElement>("[data-agent-ref]");
    elements.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const ref = el.getAttribute("data-agent-ref");
      const box = document.createElement("div");
      box.style.cssText = `position:absolute;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;border:2px solid #ff3b30;box-sizing:border-box;`;
      const label = document.createElement("div");
      label.textContent = ref;
      label.style.cssText =
        "position:absolute;top:-2px;left:-2px;background:#ff3b30;color:white;padding:1px 4px;font-size:10px;font-weight:bold;border-radius:0 0 4px 0;";
      box.appendChild(label);
      layer.appendChild(box);
    });
    document.body.appendChild(layer);
  });
}

async function removeAnnotations(
  page: import("playwright-core").Page,
): Promise<void> {
  await page.evaluate(() => {
    const existing = document.getElementById("__bt_annotation_layer__");
    if (existing) existing.remove();
  });
}

export async function browserVision(
  input: VisionInput,
): Promise<ActionResult<VisionResult>> {
  if (!input.question) return failure("question is required");
  const cfg = getConfig();
  return withSession(input.taskId, async (session) => {
    await mkdir(cfg.screenshotDir, { recursive: true });
    void pruneOldScreenshots(cfg.screenshotDir);
    const filename = `browser_screenshot_${randomUUID()}.png`;
    const path = join(cfg.screenshotDir, filename);
    let annotated = false;
    try {
      if (input.annotate) {
        await injectAnnotations(session.page);
        annotated = true;
      }
      await session.page.screenshot({ path, fullPage: true });
    } catch (err) {
      return failure(`screenshot failed: ${errorMessage(err)}`);
    } finally {
      if (annotated) {
        await removeAnnotations(session.page).catch(() => undefined);
      }
    }
    logDebug("screenshot saved", path);
    const result = await analyzeScreenshot({
      pngPath: path,
      question: input.question,
      model: input.model,
    });
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return {
      success: true,
      analysis: result.analysis,
      screenshot_path: path,
      model: result.model,
    } as ActionResult<VisionResult>;
  });
}

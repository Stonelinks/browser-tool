import type { Page } from "playwright-core";
import { snapshotScript, type SnapshotPayload } from "./injected.js";
import { truncateSnapshot } from "./truncate.js";
import { getConfig } from "../config.js";

export interface BuildSnapshotOptions {
  full?: boolean;
}

export interface BuildSnapshotResult {
  text: string;
  refCount: number;
  truncated: boolean;
  url: string;
  title: string;
}

export async function buildSnapshot(page: Page, opts: BuildSnapshotOptions = {}): Promise<BuildSnapshotResult> {
  const compact = !opts.full;
  const cfg = getConfig();
  const payload: SnapshotPayload = await page.evaluate(snapshotScript, { compact });
  const { text, truncated } = truncateSnapshot(payload.text, cfg.maxSnapshotChars);
  return {
    text,
    refCount: payload.refCount,
    truncated,
    url: page.url(),
    title: await page.title(),
  };
}

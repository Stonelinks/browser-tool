import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  headless: boolean;
  inactivityTimeoutMs: number;
  reaperIntervalMs: number;
  cacheDir: string;
  screenshotDir: string;
  visionModel: string;
  visionBaseUrl: string;
  defaultTaskId: string;
  commandTimeoutMs: number;
  maxSnapshotChars: number;
  debug: boolean;
}

function envBool(name: string, def: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return def;
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes";
}

function envInt(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined) return def;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

let cached: Config | null = null;

export function getConfig(): Config {
  if (cached) return cached;
  const cacheDir =
    process.env.BROWSER_TOOL_CACHE_DIR ??
    join(homedir(), ".cache", "browser-tool");
  cached = {
    headless: envBool("BROWSER_TOOL_HEADLESS", true),
    inactivityTimeoutMs: envInt("BROWSER_INACTIVITY_TIMEOUT", 300) * 1000,
    reaperIntervalMs: envInt("BROWSER_REAPER_INTERVAL", 30) * 1000,
    cacheDir,
    screenshotDir: join(cacheDir, "screenshots"),
    visionModel:
      process.env.BROWSER_TOOL_VISION_MODEL ?? "moonshotai/Kimi-K2.5",
    visionBaseUrl:
      process.env.BROWSER_TOOL_VISION_BASE_URL ?? "http://localhost:4000/flex",
    defaultTaskId: "default",
    commandTimeoutMs: envInt("BROWSER_COMMAND_TIMEOUT", 30) * 1000,
    maxSnapshotChars: envInt("BROWSER_MAX_SNAPSHOT_CHARS", 8000),
    debug: envBool("BROWSER_TOOL_DEBUG", false),
  };
  return cached;
}

export function resetConfig(): void {
  cached = null;
}

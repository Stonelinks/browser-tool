import { getConfig } from "./config.js";

export function logDebug(...args: unknown[]): void {
  if (getConfig().debug) {
    console.error("[browser-tool]", ...args);
  }
}

export function logError(...args: unknown[]): void {
  console.error("[browser-tool error]", ...args);
}

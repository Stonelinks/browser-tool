import { SessionManager } from "./manager.js";
import { logError } from "../logger.js";

let registered = false;
let shuttingDown = false;

export function registerLifecycleHandlers(): void {
  if (registered) return;
  registered = true;

  const shutdown = async (signal: string, exitCode: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await Promise.race([
        SessionManager.getInstance().closeAll(),
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ]);
    } catch (err) {
      logError("shutdown error", err);
    }
    if (signal === "uncaughtException") {
      process.exit(exitCode);
    }
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT", 130).then(() => process.exit(130));
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM", 143).then(() => process.exit(143));
  });
  process.on("beforeExit", () => {
    void shutdown("beforeExit", 0);
  });
  process.on("uncaughtException", (err) => {
    logError("uncaughtException", err);
    void shutdown("uncaughtException", 1);
  });
}

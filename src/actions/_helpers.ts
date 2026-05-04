import { SessionManager } from "../session/manager.js";
import { Session } from "../session/session.js";
import { getConfig } from "../config.js";
import type { Failure } from "../types.js";

export async function withSession<T>(
  taskId: string | undefined,
  fn: (session: Session) => Promise<T>,
): Promise<T> {
  const cfg = getConfig();
  const id = taskId ?? cfg.defaultTaskId;
  return SessionManager.getInstance().runExclusive(id, async () => {
    try {
      const session = await SessionManager.getInstance().getOrCreate(id);
      session.touch();
      return fn(session);
    } catch (err) {
      // If the error is a session limit error, convert to a failure result
      // if the return type supports it; otherwise rethrow.
      if (err instanceof Error && err.message.includes("Session limit reached")) {
        return { success: false, error: err.message } as T;
      }
      throw err;
    }
  });
}

export function refSelector(rawRef: string): string {
  const trimmed = rawRef.trim();
  const match = trimmed.match(/^@?e?(\d+)$/i);
  if (!match) {
    throw new Error(
      `Invalid ref "${rawRef}". Expected formats: "@e5", "e5", or "5".`,
    );
  }
  return `[data-agent-ref="${match[1]}"]`;
}

export function refNumber(rawRef: string): string {
  const trimmed = rawRef.trim();
  const match = trimmed.match(/^@?e?(\d+)$/i);
  if (!match) {
    throw new Error(
      `Invalid ref "${rawRef}". Expected formats: "@e5", "e5", or "5".`,
    );
  }
  return match[1] as string;
}

export function failure(error: string): Failure {
  return { success: false, error };
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

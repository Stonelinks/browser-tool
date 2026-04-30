#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { z } from "zod";
import { findSpec, TOOL_SPECS } from "../schema.js";
import { SessionManager } from "../session/manager.js";
import { registerLifecycleHandlers } from "../session/lifecycle.js";

const ACTION_TO_TOOL: Record<string, string> = {
  navigate: "browser_navigate",
  snapshot: "browser_snapshot",
  click: "browser_click",
  type: "browser_type",
  scroll: "browser_scroll",
  back: "browser_back",
  press: "browser_press",
  console: "browser_console",
  "get-images": "browser_get_images",
  images: "browser_get_images",
  vision: "browser_vision",
};

function printUsage(): void {
  const lines: string[] = [];
  lines.push(
    "Usage: browser-tool <action> [--task-id ID] [--<arg> <value> ...]",
  );
  lines.push("");
  lines.push("Actions:");
  for (const [verb, name] of Object.entries(ACTION_TO_TOOL)) {
    const spec = findSpec(name);
    if (!spec) continue;
    if (verb === "images") continue; // alias
    lines.push(`  ${verb.padEnd(12)} ${spec.description.split(".")[0]}.`);
  }
  lines.push("");
  lines.push("Common flags:");
  lines.push(
    "  --task-id ID       Isolate this session from others (default 'default').",
  );
  lines.push("  --json-pretty      Pretty-print the JSON result.");
  lines.push("  --help             Show this message.");
  process.stderr.write(lines.join("\n") + "\n");
}

function coerceArg(schema: z.ZodTypeAny, raw: string | boolean): unknown {
  if (typeof raw === "boolean") return raw;
  // Try to peek inner type for booleans / numbers.
  const def = (
    schema as unknown as {
      _def?: { typeName?: string; innerType?: z.ZodTypeAny };
    }
  )._def;
  let inner: z.ZodTypeAny | undefined = schema;
  if (def?.innerType) inner = def.innerType;
  const innerDef = (inner as unknown as { _def?: { typeName?: string } })._def;
  const tn = innerDef?.typeName;
  if (tn === "ZodBoolean") {
    if (raw === "true" || raw === "1") return true;
    if (raw === "false" || raw === "0") return false;
    return raw;
  }
  if (tn === "ZodNumber") {
    const n = Number(raw);
    if (!Number.isFinite(n)) return raw;
    return n;
  }
  return raw;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printUsage();
    process.exit(argv.length === 0 ? 2 : 0);
  }
  const verb = argv[0] as string;
  const toolName = ACTION_TO_TOOL[verb];
  if (!toolName) {
    process.stderr.write(`Unknown action: ${verb}\n`);
    printUsage();
    process.exit(2);
  }
  const spec = findSpec(toolName);
  if (!spec) {
    process.stderr.write(`No spec for ${toolName}\n`);
    process.exit(2);
  }

  // Build options dynamically from schema shape.
  const shape = (spec.inputSchema as z.ZodObject<z.ZodRawShape>).shape;
  const options: Record<
    string,
    { type: "string" | "boolean"; short?: string }
  > = {
    "task-id": { type: "string" },
    "json-pretty": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  };
  for (const [key, valSchema] of Object.entries(shape)) {
    const flagName = key.replace(/_/g, "-");
    if (flagName === "task-id") continue;
    const def = (
      valSchema as unknown as {
        _def?: { typeName?: string; innerType?: z.ZodTypeAny };
      }
    )._def;
    let inner: z.ZodTypeAny = valSchema as z.ZodTypeAny;
    if (def?.innerType) inner = def.innerType;
    const innerTn = (inner as unknown as { _def?: { typeName?: string } })._def
      ?.typeName;
    options[flagName] =
      innerTn === "ZodBoolean" ? { type: "boolean" } : { type: "string" };
  }

  let parsed: {
    values: Record<string, string | boolean | undefined>;
    positionals: string[];
  };
  try {
    parsed = parseArgs({
      args: argv.slice(1),
      options,
      allowPositionals: true,
      strict: false,
    }) as typeof parsed;
  } catch (err) {
    process.stderr.write(`Argument parse error: ${(err as Error).message}\n`);
    process.exit(2);
  }
  if (parsed.values.help) {
    process.stderr.write(
      `Action: ${verb} (${toolName})\n${spec.description}\n\nFlags:\n`,
    );
    for (const flag of Object.keys(options))
      process.stderr.write(`  --${flag}\n`);
    process.exit(0);
  }

  // Translate flags to schema-shaped args.
  const args: Record<string, unknown> = {};
  if (parsed.values["task-id"]) args.task_id = parsed.values["task-id"];
  for (const [key, valSchema] of Object.entries(shape)) {
    if (key === "task_id") continue;
    const flagName = key.replace(/_/g, "-");
    const raw = parsed.values[flagName];
    if (raw !== undefined) {
      args[key] = coerceArg(valSchema as z.ZodTypeAny, raw);
    }
  }
  // Positional fallback for the first required string argument.
  if (parsed.positionals.length > 0) {
    const requiredString = Object.entries(shape).find(([k, v]) => {
      if (k === "task_id") return false;
      const tn = (
        v as unknown as {
          _def?: { typeName?: string; innerType?: z.ZodTypeAny };
        }
      )._def?.typeName;
      return tn === "ZodString" && args[k] === undefined;
    });
    if (requiredString) {
      args[requiredString[0]] = parsed.positionals[0];
    }
  }

  registerLifecycleHandlers();
  let exitCode = 0;
  try {
    const result = await spec.handler(args);
    const out = parsed.values["json-pretty"]
      ? JSON.stringify(result, null, 2)
      : JSON.stringify(result);
    process.stdout.write(out + "\n");
    if (!result.success) exitCode = 1;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(
      JSON.stringify({ success: false, error: message }) + "\n",
    );
    exitCode = 1;
  } finally {
    await SessionManager.getInstance().closeAll();
  }
  process.exit(exitCode);
}

void main();

#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { TOOL_SPECS, findSpec } from "../schema.js";
import { SessionManager } from "../session/manager.js";
import { registerLifecycleHandlers } from "../session/lifecycle.js";
import { logError } from "../logger.js";

async function main(): Promise<void> {
  registerLifecycleHandlers();
  const server = new Server(
    { name: "browser-tool", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_SPECS.map((s) => ({
      name: s.name,
      description: s.description,
      inputSchema: zodToJsonSchema(s.inputSchema, { target: "jsonSchema7" }) as Record<
        string,
        unknown
      >,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const spec = findSpec(req.params.name);
    if (!spec) {
      return {
        content: [
          { type: "text", text: JSON.stringify({ success: false, error: `Unknown tool: ${req.params.name}` }) },
        ],
        isError: true,
      };
    }
    try {
      const result = await spec.handler(req.params.arguments ?? {});
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: !result.success,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: message }) }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(async (err) => {
  logError("MCP server fatal", err);
  await SessionManager.getInstance().closeAll();
  process.exit(1);
});

import { test, expect } from "bun:test";
import { startFixtureServer } from "./fixtures/server.js";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: unknown;
}

async function readResponse(stdout: ReadableStream<Uint8Array>, expectedId: number, timeoutMs = 30000): Promise<JsonRpcResponse> {
  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const start = Date.now();
  try {
    while (Date.now() - start < timeoutMs) {
      const { value, done } = await reader.read();
      if (done) throw new Error("MCP server closed stdout before responding");
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line) as JsonRpcResponse;
          if (obj.id === expectedId) return obj;
        } catch {
          // not JSON-RPC; ignore
        }
      }
    }
    throw new Error(`timeout waiting for response id=${expectedId}`);
  } finally {
    reader.releaseLock();
  }
}

interface BunFileSink {
  write(data: string | Uint8Array | ArrayBuffer): number;
  flush(): number | Promise<number>;
  end(): number | Promise<number>;
}

function send(stdin: BunFileSink, payload: unknown): void {
  stdin.write(JSON.stringify(payload) + "\n");
  void stdin.flush();
}

test("MCP server lists 10 tools and handles a real navigate call", async () => {
  const fixtures = await startFixtureServer();
  const proc = Bun.spawn({
    cmd: ["bun", "run", "src/mcp/server.ts"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, BROWSER_TOOL_DEBUG: "0" },
  });
  try {
    send(proc.stdin as unknown as BunFileSink, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0.0.1" } },
    });
    await readResponse(proc.stdout as unknown as ReadableStream<Uint8Array>, 1);
    send(proc.stdin as unknown as BunFileSink, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    send(proc.stdin as unknown as BunFileSink, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    const list = await readResponse(proc.stdout as unknown as ReadableStream<Uint8Array>, 2);
    expect(list.result).toBeDefined();
    const tools = (list.result as { tools: Array<{ name: string; inputSchema: unknown }> }).tools;
    expect(tools.length).toBe(11);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "browser_back",
        "browser_click",
        "browser_console",
        "browser_get_images",
        "browser_network",
        "browser_navigate",
        "browser_press",
        "browser_scroll",
        "browser_snapshot",
        "browser_type",
        "browser_vision",
      ].sort(),
    );
    for (const t of tools) {
      expect(t.inputSchema).toBeDefined();
    }
    send(proc.stdin as unknown as BunFileSink, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "browser_navigate",
        arguments: { url: `${fixtures.url}/form.html`, task_id: "mcp-smoke" },
      },
    });
    const callRes = await readResponse(proc.stdout as unknown as ReadableStream<Uint8Array>, 3, 60000);
    expect(callRes.result).toBeDefined();
    const content = (callRes.result as { content: Array<{ type: string; text: string }> }).content;
    expect(content[0]?.type).toBe("text");
    const parsed = JSON.parse(content[0]!.text);
    expect(parsed.success).toBe(true);
    expect(parsed.title).toBe("Form Test");

    // Validation error path: missing required `url` returns a graceful error result.
    send(proc.stdin as unknown as BunFileSink, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "browser_navigate", arguments: { task_id: "mcp-smoke" } },
    });
    const badRes = await readResponse(proc.stdout as unknown as ReadableStream<Uint8Array>, 4, 30000);
    const badContent = (badRes.result as { content: Array<{ text: string }>; isError: boolean });
    expect(badContent.isError).toBe(true);
    const badParsed = JSON.parse(badContent.content[0]!.text);
    expect(badParsed.success).toBe(false);
    expect(badParsed.error).toContain("Invalid arguments");
  } finally {
    proc.kill();
    await proc.exited;
    await fixtures.stop();
  }
}, 90000);

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface FixtureServer {
  url: string;
  port: number;
  stop: () => Promise<void>;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".css": "text/css",
  ".js": "application/javascript",
};

function ext(p: string): string {
  const i = p.lastIndexOf(".");
  return i >= 0 ? p.slice(i) : "";
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      const path = u.pathname;
      // /results returns a results page reflecting the q param.
      if (path === "/results") {
        const q = u.searchParams.get("q") ?? "";
        const escaped = q.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return new Response(
          `<!doctype html><html><head><title>Results</title></head><body><main><h1>Results</h1><p id="result-text">You searched for: ${escaped}</p><a href="/">Home</a></main></body></html>`,
          { headers: { "content-type": "text/html; charset=utf-8" } },
        );
      }
      if (path === "/about") {
        return new Response(
          `<!doctype html><html><head><title>About</title></head><body><h1>About</h1></body></html>`,
          { headers: { "content-type": "text/html; charset=utf-8" } },
        );
      }
      // /static/cat.png and /static/dog.png — synthesize tiny PNG bytes.
      if (path === "/static/cat.png" || path === "/static/dog.png") {
        const tinyPng = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
          "base64",
        );
        return new Response(tinyPng, { headers: { "content-type": "image/png" } });
      }
      // Static fixture files: form.html, scroll.html, images.html, console.html
      const lookup = path === "/" ? "/form.html" : path;
      const filename = lookup.startsWith("/") ? lookup.slice(1) : lookup;
      if (filename.includes("..")) return new Response("nope", { status: 400 });
      const filePath = join(__dirname, filename);
      const file = Bun.file(filePath);
      if (!(await file.exists())) {
        return new Response("not found", { status: 404 });
      }
      const e = ext(filename);
      return new Response(await file.arrayBuffer(), {
        headers: { "content-type": TYPES[e] ?? "application/octet-stream" },
      });
    },
  });
  const port = server.port as number;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    stop: async () => {
      server.stop(true);
    },
  };
}

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { loadArtifactHtml } from "./artifacts.js";
import { resolveSubmission, isPending } from "./longPoll.js";
import { attachWebSocketServer, viewerCount } from "./ws.js";
import { log } from "./log.js";
import type { SubmissionPayload } from "../shared/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve viewer HTML. In dev (tsx) we're at src/server/, viewer is at src/viewer/.
// In prod (tsc) we'd be at dist/server/, viewer must be copied to dist/viewer/.
function resolveViewerHtmlPath(): string {
  const candidates = [
    resolvePath(__dirname, "..", "viewer", "index.html"),
    resolvePath(__dirname, "..", "..", "src", "viewer", "index.html"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0]; // fall through; readFile will throw a clear error
}

const VIEWER_HTML_PATH = resolveViewerHtmlPath();
const MAX_BODY = 50 * 1024 * 1024; // 50 MB

async function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("PAYLOAD_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function send(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  contentType = "text/plain; charset=utf-8",
): void {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function notFound(res: ServerResponse) {
  send(res, 404, "Not Found");
}

export interface HttpServerHandle {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export function startHttpServer(port: number): Promise<HttpServerHandle> {
  const server = createServer(async (req, res) => {
    try {
      const url = req.url || "/";
      const method = req.method || "GET";

      // Permissive CORS for local-host clients (tests, MCP Inspector).
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "content-type");

      if (method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (method === "GET" && (url === "/" || url === "/index.html")) {
        try {
          const html = await readFile(VIEWER_HTML_PATH, "utf8");
          return send(res, 200, html, "text/html; charset=utf-8");
        } catch (e) {
          log(`failed to read viewer html: ${String(e)}`);
          return send(res, 500, "viewer html unavailable");
        }
      }

      if (method === "GET" && url.startsWith("/artifacts/")) {
        const idRaw = url.slice("/artifacts/".length).split("?")[0];
        // UUIDs only: hex + dashes
        if (!/^[a-f0-9-]{8,}$/i.test(idRaw)) return notFound(res);
        const html = await loadArtifactHtml(idRaw);
        if (!html) return notFound(res);
        return send(res, 200, html, "text/html; charset=utf-8");
      }

      if (method === "POST" && url === "/submit") {
        let body: SubmissionPayload;
        try {
          const raw = await readBody(req);
          body = JSON.parse(raw.toString("utf8"));
        } catch (e) {
          const msg = e instanceof Error ? e.message : "BAD_REQUEST";
          return send(
            res,
            msg === "PAYLOAD_TOO_LARGE" ? 413 : 400,
            msg,
          );
        }
        if (
          !body ||
          typeof body.artifactId !== "string" ||
          !Array.isArray(body.buckets)
        ) {
          return send(res, 400, "BAD_REQUEST: missing artifactId or buckets");
        }
        const ok = resolveSubmission(body.artifactId, body);
        if (!ok) {
          return send(
            res,
            409,
            "CONFLICT: artifactId is not currently pending",
          );
        }
        return send(res, 204, "");
      }

      if (method === "GET" && url === "/health") {
        const json = JSON.stringify({
          ok: true,
          viewers: viewerCount(),
          pending: isPending() ? 1 : 0,
        });
        return send(res, 200, json, "application/json");
      }

      if (method === "POST" && url === "/debug-log") {
        try {
          const raw = await readBody(req);
          const body = JSON.parse(raw.toString("utf8")) as {
            level?: string;
            message?: string;
            stack?: string;
            context?: unknown;
          };
          log(
            `[viewer ${body.level || "error"}] ${body.message || "(no message)"}`,
          );
          if (body.stack) log(`  stack: ${body.stack}`);
          if (body.context !== undefined) {
            log(`  context: ${JSON.stringify(body.context).slice(0, 500)}`);
          }
        } catch (e) {
          log(`/debug-log parse error: ${String(e)}`);
        }
        return send(res, 204, "");
      }

      notFound(res);
    } catch (e) {
      log(`http handler error: ${String(e)}`);
      try {
        send(res, 500, "Internal Server Error");
      } catch {
        // ignore
      }
    }
  });

  attachWebSocketServer(server);

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        close: () =>
          new Promise<void>((res, rej) =>
            server.close((err) => (err ? rej(err) : res())),
          ),
      });
    });
  });
}

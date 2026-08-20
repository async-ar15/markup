import { startHttpServer } from "./server/http.js";
import { startMcpServer } from "./server/mcp.js";
import { rejectPending } from "./server/longPoll.js";
import { log } from "./server/log.js";

const DEFAULT_PORT = 14271;

const args = new Set(process.argv.slice(2));
const isHttpOnly = args.has("--http-only");
const isMcpOnly = args.has("--mcp-only");

function parsePort(): number {
  const envPort = process.env.MARKUP_PORT || process.env.PORT;
  if (envPort) {
    const n = Number(envPort);
    if (Number.isFinite(n) && n > 0 && n < 65536) return n;
  }
  return DEFAULT_PORT;
}

async function tryStartHttp(): Promise<{ url: string; port: number; close: () => Promise<void> }> {
  const requested = parsePort();
  // Try the requested port first; if EADDRINUSE, walk forward up to +5.
  let lastErr: unknown = null;
  for (let i = 0; i < 6; i++) {
    const port = requested + i;
    try {
      const handle = await startHttpServer(port);
      return handle;
    } catch (e) {
      lastErr = e;
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code !== "EADDRINUSE") throw e;
      log(`port ${port} in use, trying ${port + 1}`);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("failed to bind any port");
}

async function main(): Promise<void> {
  let httpHandle: { url: string; port: number; close: () => Promise<void> } | null = null;

  if (!isMcpOnly) {
    httpHandle = await tryStartHttp();
    log(`viewer + ws live at ${httpHandle.url}`);
  }

  const httpUrl = httpHandle?.url || `http://127.0.0.1:${parsePort()}`;

  if (!isHttpOnly) {
    await startMcpServer(httpUrl);
  } else {
    log("running in --http-only mode (no MCP)");
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log(`shutdown requested via ${signal}`);
    rejectPending("PORTAL_SHUTDOWN: server is shutting down");
    try {
      await httpHandle?.close();
    } catch (e) {
      log(`error closing http server: ${String(e)}`);
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) log(err.stack);
  process.exit(1);
});

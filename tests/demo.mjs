// Interactive end-to-end demo of markup.
//
// What it does:
//   1. Spawns the markup server.
//   2. Initialises the MCP protocol over stdio (this script plays the role of
//      the agent client).
//   3. Loads an HTML artifact from disk (defaults to the visual plan at
//      ~/.agent/diagrams/markup-v0-plan.html, override with HTML_FILE).
//   4. Calls the present_and_await_feedback tool with that HTML.
//   5. Opens the viewer in the user's default browser (server does this).
//   6. Blocks until the user submits via Cmd+Enter in the viewer.
//   7. Saves each returned screenshot to ~/.markup/feedback-<ts>/region-N.png
//      and prints the comments + image paths to stdout.

import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.MARKUP_PORT || 14271);
const ENDPOINT = `http://127.0.0.1:${PORT}`;
const DEFAULT_HTML = join(homedir(), ".agent", "diagrams", "markup-v0-plan.html");
const HTML_FILE = process.env.HTML_FILE || DEFAULT_HTML;

function line(obj) { return JSON.stringify(obj) + "\n"; }

async function main() {
  let html;
  try {
    html = await readFile(HTML_FILE, "utf8");
  } catch (e) {
    console.error(`Could not read ${HTML_FILE}: ${e.message}`);
    console.error(`Set HTML_FILE to an existing HTML file and re-run.`);
    process.exit(1);
  }

  console.log(`\nmarkup demo`);
  console.log(`  artifact: ${HTML_FILE} (${html.length} bytes)`);
  console.log(`  viewer:   ${ENDPOINT}/`);
  console.log("");

  const env = { ...process.env, MARKUP_PORT: String(PORT) };
  const proc = spawn("npx", ["tsx", "src/index.ts"], {
    stdio: ["pipe", "pipe", "pipe"],
    env,
  });

  const pending = new Map();
  let stdoutBuf = "";
  proc.stdout.on("data", (chunk) => {
    stdoutBuf += chunk.toString("utf8");
    const idx = stdoutBuf.lastIndexOf("\n");
    if (idx === -1) return;
    const ready = stdoutBuf.slice(0, idx);
    stdoutBuf = stdoutBuf.slice(idx + 1);
    for (const ln of ready.split("\n")) {
      if (!ln.trim()) continue;
      let msg;
      try { msg = JSON.parse(ln); } catch { continue; }
      if (typeof msg.id === "number" && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      }
    }
  });
  proc.stderr.on("data", (c) => process.stderr.write(c));
  proc.on("exit", (code) => {
    if (code && code !== 0) console.error(`server exited with code ${code}`);
  });

  let nextId = 1;
  function rpc(method, params, timeoutMs) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      proc.stdin.write(line({ jsonrpc: "2.0", id, method, params }));
      if (timeoutMs && timeoutMs > 0) {
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`rpc timeout (${timeoutMs}ms): ${method}`));
          }
        }, timeoutMs);
      }
    });
  }
  function notify(method, params) {
    proc.stdin.write(line({ jsonrpc: "2.0", method, params }));
  }

  // Wait for HTTP up.
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${ENDPOINT}/health`);
      if (r.ok) break;
    } catch {}
    await delay(120);
  }

  await rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "markup-demo", version: "0.1.0" },
  }, 5000);
  notify("notifications/initialized", {});

  console.log("server is up — viewer should open automatically.");
  console.log("scroll the page, type comments (Enter queues, Cmd+Enter submits).");
  console.log("waiting for your submission…\n");

  const result = await rpc(
    "tools/call",
    {
      name: "present_and_await_feedback",
      arguments: { html, title: "markup demo" },
    },
    // no timeout — the tool blocks indefinitely
  );

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(homedir(), ".markup", `feedback-${ts}`);
  await mkdir(outDir, { recursive: true });

  console.log("\n=== feedback received ===\n");

  const content = result?.content || [];
  const structured = result?.structuredContent || {};

  if (structured.annotated === false) {
    console.log("user submitted with NO comments (annotated: false).");
    proc.kill();
    process.exit(0);
  }

  let regionIdx = 0;
  let imgIdx = 0;
  for (const block of content) {
    if (block.type === "text") {
      console.log(block.text);
      console.log("");
    } else if (block.type === "image") {
      regionIdx++;
      const filename = `region-${String(regionIdx).padStart(2, "0")}.png`;
      const path = join(outDir, filename);
      const buf = Buffer.from(block.data, "base64");
      await writeFile(path, buf);
      console.log(`  screenshot → ${path} (${buf.length} bytes)`);
      imgIdx++;
    }
  }

  console.log(`\nsaved ${imgIdx} screenshot(s) to ${outDir}\n`);
  proc.kill();
  await delay(200);
  process.exit(0);
}

main().catch((err) => {
  console.error("demo crashed:", err);
  process.exit(1);
});

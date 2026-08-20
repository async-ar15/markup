// End-to-end smoke test for markup.
//
// Spawns the server with stdio MCP transport, drives the protocol manually,
// simulates a viewer submission via WebSocket + POST /submit, and verifies
// the tool/call response includes the image+text content blocks.

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";

const PORT = 14380; // off the default so it doesn't collide
const ENDPOINT = `http://127.0.0.1:${PORT}`;

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  ok  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${detail ? "\n       " + detail : ""}`);
  }
}

// Tiny valid 1x1 PNG as base64 (transparent pixel).
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function frameLine(obj) {
  return JSON.stringify(obj) + "\n";
}

function parseLines(buf, onMsg) {
  let s = buf.toString("utf8");
  const lines = s.split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      onMsg(JSON.parse(line));
    } catch {
      // ignore non-JSON lines (shouldn't happen on stdout but safe)
    }
  }
}

async function main() {
  console.log(`\nmarkup smoke test (port ${PORT})\n`);

  const env = { ...process.env, MARKUP_PORT: String(PORT) };
  const proc = spawn("npx", ["tsx", "src/index.ts"], {
    stdio: ["pipe", "pipe", "pipe"],
    env,
  });

  /** @type {Map<number, {resolve: Function, reject: Function}>} */
  const pendingRpc = new Map();
  let stdoutBuf = "";
  proc.stdout.on("data", (chunk) => {
    stdoutBuf += chunk.toString("utf8");
    const idx = stdoutBuf.lastIndexOf("\n");
    if (idx === -1) return;
    const ready = stdoutBuf.slice(0, idx);
    stdoutBuf = stdoutBuf.slice(idx + 1);
    parseLines(Buffer.from(ready), (msg) => {
      if (typeof msg.id === "number" && pendingRpc.has(msg.id)) {
        const p = pendingRpc.get(msg.id);
        pendingRpc.delete(msg.id);
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      }
    });
  });
  proc.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });

  let nextId = 1;
  function rpc(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pendingRpc.set(id, { resolve, reject });
      proc.stdin.write(frameLine({ jsonrpc: "2.0", id, method, params }));
      setTimeout(() => {
        if (pendingRpc.has(id)) {
          pendingRpc.delete(id);
          reject(new Error(`rpc timeout: ${method}`));
        }
      }, 15000);
    });
  }
  function notify(method, params) {
    proc.stdin.write(frameLine({ jsonrpc: "2.0", method, params }));
  }

  // Wait until the HTTP server is up (health endpoint responds).
  let httpUp = false;
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${ENDPOINT}/health`);
      if (r.ok) {
        httpUp = true;
        break;
      }
    } catch {}
    await delay(120);
  }
  check("http server up on " + ENDPOINT, httpUp);
  if (!httpUp) {
    proc.kill();
    process.exit(1);
  }

  // 1. Initialize MCP
  const init = await rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "0.0.0" },
  });
  check("initialize ok", !!init && !!init.serverInfo);
  check("server name", init?.serverInfo?.name === "markup", JSON.stringify(init?.serverInfo));
  notify("notifications/initialized", {});

  // 2. tools/list
  const list = await rpc("tools/list", {});
  const hasTool = Array.isArray(list?.tools) &&
    list.tools.some((t) => t.name === "present_and_await_feedback");
  check("tool present_and_await_feedback registered", hasTool);

  // 3. Connect a WS client (simulating a viewer) to receive artifact pushes.
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const wsReady = new Promise((r, j) => {
    ws.once("open", r);
    ws.once("error", j);
  });
  await wsReady;
  /** @type {string|null} */
  let artifactId = null;
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "artifact" && msg.id) artifactId = msg.id;
    } catch {}
  });

  // 4. Fire tools/call (will block on long-poll until we POST /submit).
  const callPromise = rpc("tools/call", {
    name: "present_and_await_feedback",
    arguments: {
      html: "<!doctype html><html><body><h1>smoke test artifact</h1><p>region one.</p><div style='height:1500px'></div><p>region two, after a tall spacer.</p></body></html>",
      title: "smoke test",
    },
  });

  // 5. Wait for the artifact broadcast via WS.
  for (let i = 0; i < 50; i++) {
    if (artifactId) break;
    await delay(100);
  }
  check("received artifact via ws", !!artifactId);
  if (!artifactId) {
    proc.kill();
    process.exit(1);
  }

  // 6. Simulate a viewer submission with two buckets.
  const submitResp = await fetch(`${ENDPOINT}/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactId,
      buckets: [
        {
          range: [0, 800],
          comments: [
            { id: "c1", text: "first region looks fine", scrollY: 100, viewportH: 700, timestamp: Date.now() },
          ],
          dataUrl: `data:image/png;base64,${TINY_PNG_B64}`,
        },
        {
          range: [1500, 2300],
          comments: [
            { id: "c2", text: "second region needs work", scrollY: 1600, viewportH: 700, timestamp: Date.now() + 1 },
            { id: "c3", text: "also: typo here", scrollY: 1700, viewportH: 700, timestamp: Date.now() + 2 },
          ],
          dataUrl: `data:image/png;base64,${TINY_PNG_B64}`,
        },
      ],
    }),
  });
  check("/submit returned 204", submitResp.status === 204, `got ${submitResp.status}`);

  // 7. Receive the tool/call response.
  const callResult = await callPromise;
  check("tool/call resolved", !!callResult);

  const content = callResult?.content;
  check("content is an array", Array.isArray(content));
  const types = content?.map((c) => c.type) || [];
  // expect: intro text, image, region text, image, region text  (5 items for 2 buckets)
  check("first content is text", types[0] === "text", JSON.stringify(types));
  check("contains image blocks", types.includes("image"), JSON.stringify(types));
  const imageBlocks = content?.filter((c) => c.type === "image") || [];
  check("two image blocks", imageBlocks.length === 2, `got ${imageBlocks.length}`);
  check(
    "image data is base64 (no data: prefix)",
    imageBlocks.every((c) => typeof c.data === "string" && !c.data.startsWith("data:")),
  );
  check(
    "image mime is image/png",
    imageBlocks.every((c) => c.mimeType === "image/png"),
  );
  check(
    "image data matches tiny png",
    imageBlocks.every((c) => c.data === TINY_PNG_B64),
  );

  const structured = callResult?.structuredContent;
  check("structuredContent.annotated true", structured?.annotated === true);
  check("structuredContent.buckets length 2", Array.isArray(structured?.buckets) && structured.buckets.length === 2);

  // 8. Concurrent call should be rejected (PORTAL_BUSY).
  // First we need to call once more to leave no pending state.
  // Actually after the resolve, the registry is empty, so a second call would block.
  // To verify PORTAL_BUSY, fire two calls back-to-back without resolving the first.
  const blocking = rpc("tools/call", {
    name: "present_and_await_feedback",
    arguments: { html: "<html><body>blocker</body></html>" },
  });
  // wait briefly for the first one to register
  await delay(150);
  const busy = await rpc("tools/call", {
    name: "present_and_await_feedback",
    arguments: { html: "<html><body>second</body></html>" },
  });
  const busyText = busy?.content?.[0]?.text || "";
  check("second concurrent call returns isError", busy?.isError === true, JSON.stringify(busy));
  check(
    "second call mentions PORTAL_BUSY",
    busyText.includes("PORTAL_BUSY"),
    JSON.stringify(busyText),
  );

  // Resolve the blocker so we exit cleanly. Need its artifact id from ws.
  // The WS handler keeps updating artifactId on each new artifact.
  for (let i = 0; i < 50; i++) {
    if (artifactId !== null) break;
    await delay(80);
  }
  // After the first submit we cleared artifactId tracking; the blocker artifact's id
  // is whatever the ws client most recently saw. Fetch /health is fine — but easier:
  // just kill the process.
  ws.close();
  proc.kill();
  // Drain the blocker promise so node doesn't warn
  blocking.catch(() => {});

  console.log(`\nresult: ${pass} pass, ${fail} fail\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke test crashed:", err);
  process.exit(1);
});

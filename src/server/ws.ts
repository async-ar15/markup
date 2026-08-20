import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";
import type { ArtifactMeta, ArtifactWsMessage } from "../shared/types.js";
import { getCurrentArtifact } from "./artifacts.js";
import { log } from "./log.js";

const clients: Set<WebSocket> = new Set();
let wss: WebSocketServer | null = null;

export function attachWebSocketServer(httpServer: HttpServer): void {
  wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    if (req.url !== "/ws") {
      socket.destroy();
      return;
    }
    wss!.handleUpgrade(req, socket, head, (ws) => {
      clients.add(ws);
      log(`viewer connected (${clients.size} total)`);
      ws.on("close", () => {
        clients.delete(ws);
        log(`viewer disconnected (${clients.size} total)`);
      });
      ws.on("error", (err) => {
        log(`viewer ws error: ${String(err)}`);
        clients.delete(ws);
      });
      const current = getCurrentArtifact();
      if (current) {
        const msg: ArtifactWsMessage = {
          type: "artifact",
          id: current.id,
          title: current.title,
        };
        ws.send(JSON.stringify(msg));
      }
    });
  });
}

export function broadcastArtifact(meta: ArtifactMeta): void {
  const msg: ArtifactWsMessage = {
    type: "artifact",
    id: meta.id,
    title: meta.title,
  };
  const json = JSON.stringify(msg);
  let delivered = 0;
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(json);
      delivered++;
    }
  }
  log(`broadcast artifact ${meta.id} to ${delivered} viewer(s)`);
}

export function viewerCount(): number {
  let alive = 0;
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) alive++;
  }
  return alive;
}

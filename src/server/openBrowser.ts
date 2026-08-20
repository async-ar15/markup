import { spawn } from "node:child_process";
import { log } from "./log.js";

export function openBrowser(url: string): void {
  const platform = process.platform;
  try {
    if (platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else if (platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], {
        detached: true,
        stdio: "ignore",
        shell: true,
      }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
    log(`opened browser at ${url}`);
  } catch (e) {
    log(`failed to open browser: ${String(e)}`);
  }
}

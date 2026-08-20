// Stdout is reserved for the MCP JSON-RPC protocol when running over stdio.
// Everything we want to print goes to stderr to avoid corrupting the wire.
export function log(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.error("[markup]", ...args);
}

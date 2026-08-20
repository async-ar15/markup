import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { saveArtifact } from "./artifacts.js";
import { awaitSubmission } from "./longPoll.js";
import { broadcastArtifact, viewerCount } from "./ws.js";
import { formatToolResult, type ToolResult } from "./formatResult.js";
import { openBrowser } from "./openBrowser.js";
import { log } from "./log.js";

const TOOL_DESCRIPTION = `Render the supplied HTML in the user's local markup viewer (a browser window) and BLOCK until the user submits annotated feedback. Returns image content blocks (one per scroll-clustered region the user commented on) plus structured comment text. The user types comments while scrolling the artifact; you receive a screenshot of what they were looking at for each comment cluster.

Style guidance for the HTML you pass:
  • For static artifacts (specs, plans, diffs, reports, recaps, dashboards), use the visual-explainer style described at https://raw.githubusercontent.com/nicobailon/visual-explainer/refs/heads/main/plugins/visual-explainer/SKILL.md — editorial/blueprint aesthetics, semantic monospace labels, varied font pairings, no Inter+violet defaults.
  • For interactive artifacts (parameter tuners, draggable cards, clickable diagrams, design playgrounds), use a playground style: sliders, toggles, drag-and-drop, live-updating previews. Scripts run inside the iframe so anything HTML+CSS+JS is fair game.
  • The portal ALREADY provides a universal scroll-anchored comment overlay on top of your HTML — you do NOT need to bake in your own "copy as prompt" buttons or feedback widgets unless the artifact is fundamentally about widget interaction.

This tool waits indefinitely for the user to submit. The user submits via Cmd+Enter (or Ctrl+Enter) on the floating composer at the bottom of the viewer. If the user submits with zero comments, the tool result will indicate \`annotated: false\` and you should proceed with your current plan or ask the user how to continue.`;

export async function startMcpServer(httpUrl: string): Promise<void> {
  const server = new McpServer({
    name: "markup",
    version: "0.1.0",
  });

  server.registerTool(
    "present_and_await_feedback",
    {
      title: "Present HTML and Await Feedback",
      description: TOOL_DESCRIPTION,
      inputSchema: {
        html: z
          .string()
          .min(1)
          .describe(
            "The full HTML document (including DOCTYPE, head, body) to render in the viewer. Self-contained: inline CSS, inline JS, CDN-hosted assets ok.",
          ),
        title: z
          .string()
          .optional()
          .describe(
            "Optional short title for the artifact shown in the viewer's top bar.",
          ),
      },
    },
    async ({ html, title }): Promise<ToolResult> => {
      try {
        const meta = await saveArtifact(html, title);
        log(`new artifact ${meta.id} (${html.length} bytes)`);
        broadcastArtifact(meta);
        if (viewerCount() === 0) {
          openBrowser(`${httpUrl}/`);
        }
        const payload = await awaitSubmission(meta.id);
        log(
          `received submission for ${meta.id}: ${payload.buckets.length} bucket(s)`,
        );
        return formatToolResult(payload);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`tool error: ${msg}`);
        return {
          content: [
            {
              type: "text",
              text: `markup error: ${msg}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("MCP server connected over stdio");
}

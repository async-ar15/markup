import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { SubmissionPayload } from "../shared/types.js";

interface TextContent {
  type: "text";
  text: string;
}
interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export type ToolResult = CallToolResult;

const DATA_URL_PREFIX = /^data:image\/(png|jpeg|jpg);base64,/i;

export function formatToolResult(payload: SubmissionPayload): CallToolResult {
  const totalComments = payload.buckets.reduce(
    (sum, b) => sum + b.comments.length,
    0,
  );

  if (totalComments === 0) {
    return {
      content: [
        {
          type: "text",
          text: "User submitted no comments (annotated: false). Continue with your current plan or ask the user how they'd like to proceed.",
        },
      ],
      structuredContent: { annotated: false, buckets: [] },
    };
  }

  const content: Array<TextContent | ImageContent> = [];
  content.push({
    type: "text",
    text:
      `User submitted ${totalComments} comment${totalComments === 1 ? "" : "s"} ` +
      `across ${payload.buckets.length} scroll-clustered region${payload.buckets.length === 1 ? "" : "s"}. ` +
      `Each region below: first the screenshot of what the user was viewing, then their comment(s) on that region. ` +
      `Use these as direct user feedback on the artifact you rendered.`,
  });

  payload.buckets.forEach((bucket, i) => {
    const data = bucket.dataUrl.replace(DATA_URL_PREFIX, "");
    content.push({
      type: "image",
      data,
      mimeType: "image/png",
    });
    const commentLines = bucket.comments
      .map((c, j) => `  ${j + 1}. ${c.text}`)
      .join("\n");
    content.push({
      type: "text",
      text:
        `Region ${i + 1} (rendered y: ${bucket.range[0]} → ${bucket.range[1]}px) — ` +
        `${bucket.comments.length} comment${bucket.comments.length === 1 ? "" : "s"}:\n` +
        commentLines,
    });
  });

  return {
    content,
    structuredContent: {
      annotated: true,
      buckets: payload.buckets.map((b) => ({
        range: b.range,
        comments: b.comments.map((c) => ({
          text: c.text,
          scrollY: c.scrollY,
        })),
      })),
    },
  };
}

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { ArtifactMeta } from "../shared/types.js";

const ARTIFACTS_DIR = join(homedir(), ".markup", "artifacts");

let currentArtifact: ArtifactMeta | null = null;

export async function saveArtifact(
  html: string,
  title?: string,
): Promise<ArtifactMeta> {
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  const id = randomUUID();
  const htmlPath = join(ARTIFACTS_DIR, `${id}.html`);
  await writeFile(htmlPath, html, "utf8");
  const meta: ArtifactMeta = {
    id,
    title,
    htmlPath,
    createdAt: Date.now(),
  };
  currentArtifact = meta;
  return meta;
}

export async function loadArtifactHtml(id: string): Promise<string | null> {
  try {
    return await readFile(join(ARTIFACTS_DIR, `${id}.html`), "utf8");
  } catch {
    return null;
  }
}

export function getCurrentArtifact(): ArtifactMeta | null {
  return currentArtifact;
}

export function clearCurrentArtifact(): void {
  currentArtifact = null;
}

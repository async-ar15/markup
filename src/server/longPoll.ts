import type { SubmissionPayload } from "../shared/types.js";

interface PendingEntry {
  resolve: (payload: SubmissionPayload) => void;
  reject: (err: Error) => void;
  createdAt: number;
}

const pending: Map<string, PendingEntry> = new Map();

export function awaitSubmission(
  artifactId: string,
): Promise<SubmissionPayload> {
  if (pending.size > 0) {
    const existing = Array.from(pending.keys())[0];
    return Promise.reject(
      new Error(
        `PORTAL_BUSY: artifact ${existing} is already awaiting feedback`,
      ),
    );
  }
  return new Promise<SubmissionPayload>((resolve, reject) => {
    pending.set(artifactId, { resolve, reject, createdAt: Date.now() });
  });
}

export function resolveSubmission(
  artifactId: string,
  payload: SubmissionPayload,
): boolean {
  const entry = pending.get(artifactId);
  if (!entry) return false;
  entry.resolve(payload);
  pending.delete(artifactId);
  return true;
}

export function rejectPending(reason: string): boolean {
  if (pending.size === 0) return false;
  for (const [id, entry] of pending) {
    entry.reject(new Error(reason));
    pending.delete(id);
  }
  return true;
}

export function isPending(): boolean {
  return pending.size > 0;
}

export function currentPendingId(): string | null {
  for (const id of pending.keys()) return id;
  return null;
}

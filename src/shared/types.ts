export interface Comment {
  id: string;
  text: string;
  scrollY: number;
  viewportH: number;
  timestamp: number;
}

export interface ServerBucket {
  range: [number, number];
  comments: Comment[];
  dataUrl: string;
}

export interface SubmissionPayload {
  artifactId: string;
  buckets: ServerBucket[];
}

export interface ArtifactMeta {
  id: string;
  title?: string;
  htmlPath: string;
  createdAt: number;
}

export interface ArtifactWsMessage {
  type: "artifact";
  id: string;
  title?: string;
}

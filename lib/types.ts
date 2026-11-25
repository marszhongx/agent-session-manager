export type Agent = "pi" | "omp";
export type SessionStatus = "all" | "recent" | "children";
export type FocusMode = "all" | "chat" | "changes";

export interface RootInfo {
  agent: Agent;
  label: string;
  path: string;
  exists: boolean;
  sessionCount: number;
}

export interface SessionMeta {
  key: string;
  agent: Agent;
  relpath: string;
  fileName: string;
  title: string;
  cwd: string;
  project: string;
  sessionId: string;
  startedAt: string;
  updatedAt: string;
  mtime: number;
  size: number;
  model: string;
  firstUser: string;
  parentPath: string;
  parentKey: string | null;
  parentTitle: string;
  isChild: boolean;
  childCount: number;
  hasSidecar: boolean;
  active: boolean;
}

export interface SessionCounts {
  all: number;
  recent: number;
  children: number;
  active: number;
  agents: Record<string, number>;
  totalSize: number;
}

export interface SessionListResponse {
  sessions: SessionMeta[];
  counts: SessionCounts;
  roots: RootInfo[];
  elapsedMs: number;
  scannedFiles: number;
}

export interface GroupMeta {
  id: string;
  ts: string;
  model: string;
  provider: string;
  durationMs: number;
  tokens: number;
  cost: number;
}

export interface DiffLine {
  type: "add" | "del" | "ctx" | "hunk";
  old?: number;
  new?: number;
  text: string;
}

export interface ToolDiff {
  path: string;
  mode: "edit" | "write" | "patch";
  lines: DiffLine[];
  patch?: string;
  additions: number;
  deletions: number;
  truncated: boolean;
}

export interface ToolResult {
  text: string;
  chars: number;
  truncated: boolean;
  isError: boolean;
  images: number;
}

export interface TimelineItem {
  i: number;
  type: "user" | "assistant" | "thinking" | "tool" | "event";
  ts: string;
  group?: string;
  text?: string;
  chars?: number;
  images?: number;
  hidden?: boolean;
  label?: string;
  callId?: string;
  name?: string;
  target?: string;
  args?: unknown;
  diff?: ToolDiff | null;
  result?: ToolResult;
}

export interface DetailStats {
  turns: number;
  messages: number;
  toolCalls: number;
  thinkingChars: number;
  totalTokens: number;
  totalCost: number;
  durationMs: number;
  startedAt: string;
  lastEventAt: string;
}

export interface PromptRef {
  i: number;
  ts: string;
  text: string;
}

export interface SessionDetail extends SessionMeta {
  items: TimelineItem[];
  groups: Record<string, GroupMeta>;
  prompts: PromptRef[];
  stats: DetailStats;
  resumeCommand: string | null;
  truncated: boolean;
  filePath: string;
}

export interface SearchResult {
  sessionKey: string;
  title: string;
  agent: Agent;
  project: string;
  cwd: string;
  sessionId: string;
  role: "title" | "user" | "assistant" | "thinking" | "tool" | "result" | "event";
  snippet: string;
  ts: string;
  hitCount: number;
  titleMatch: boolean;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  scannedFiles: number;
  scannedBytes: number;
  elapsedMs: number;
  truncated: boolean;
}

export interface DeleteResult {
  deleted: string[];
  errors: { key: string; message: string }[];
}

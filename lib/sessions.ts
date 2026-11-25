import fs from "node:fs";
import path from "node:path";
import { INITIAL_HEAD_BYTES, getRootInfo, getRoots } from "./config";
import { encodeKey, normalizePath, readFileHead, resolveKey, resolveSessionPath, safeRelative, toPosix } from "./key";
import { isObject } from "./guards";
import {
  cleanTitle,
  deriveTitle,
  parseEventLine,
  parseTimestamp,
  projectLabel,
  resumeCommand,
  buildDetail,
} from "./parser";
import type {
  Agent,
  RootInfo,
  SessionCounts,
  SessionDetail,
  SessionListResponse,
  SessionMeta,
  SessionStatus,
} from "./types";

interface ParsedHead {
  isSession: boolean;
  title: string;
  sessionId: string;
  cwd: string;
  parentPath: string;
  startedAt: string;
  model: string;
  firstUser: string;
}

export function parseHeadText(text: string): ParsedHead {
  let isSession = false;
  let title = "";
  let sessionId = "";
  let cwd = "";
  let parentPath = "";
  let startedAt = "";
  let model = "";
  let firstUser = "";
  const lines = text.split(/\r?\n/);
  let parsed = 0;

  const consume = (event: Record<string, unknown>) => {
    const kind = String(event.type ?? "");
    if (kind === "title" || kind === "title_change") {
      const value = cleanTitle(event.title);
      if (value) title = value;
    } else if (kind === "session") {
      isSession = true;
      sessionId = String(event.id ?? sessionId);
      cwd = String(event.cwd ?? cwd);
      parentPath = String(event.parentSession ?? parentPath);
      startedAt = parseTimestamp(event.timestamp) || startedAt;
    } else if (kind === "model_change") {
      model = String(event.model ?? event.modelId ?? model);
    } else if (kind === "message" && isObject(event.message)) {
      const role = String(event.message.role ?? "");
      if (role === "user" && !firstUser) {
        const content = event.message.content;
        if (typeof content === "string") firstUser = content;
        else if (Array.isArray(content)) {
          firstUser = content
            .filter(isObject)
            .filter((block) => block.type === "text")
            .map((block) => String(block.text ?? ""))
            .filter(Boolean)
            .join("\n\n");
        }
      } else if (role === "assistant" && !model) {
        model = String(event.message.model ?? model);
      }
    }
  };

  for (const line of lines) {
    if (parsed >= 24) break;
    if (!line.trim()) continue;
    if (line.length > 20_000 && !line.includes('"role":"user"')) continue;
    const event = parseEventLine(line);
    if (!event) continue;
    parsed += 1;
    consume(event);
    if (isSession && title && model) break;
  }

  // pi sessions have no title event.  Search for the first user line without
  // parsing the large system-prompt records that precede it.
  if (!firstUser && !title) {
    for (const line of lines) {
      if (!line.includes('"role":"user"')) continue;
      const event = parseEventLine(line);
      if (event) {
        consume(event);
        if (firstUser) break;
      }
    }
  }

  return { isSession, title, sessionId, cwd, parentPath, startedAt, model, firstUser };
}

function filenameTimestamp(fileName: string): string {
  const match = fileName.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_/);
  if (!match) return "";
  return `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
}

function sessionIdFromName(fileName: string): string {
  const match = fileName.match(/_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  if (match) return match[1];
  return fileName.replace(/\.jsonl$/i, "");
}

function readParsedHead(file: string): ParsedHead {
  return parseHeadText(readFileHead(file, INITIAL_HEAD_BYTES));
}

function buildMeta(agent: Agent, relpath: string, file: string, stat: fs.Stats, parsed: ParsedHead): SessionMeta {
  const fileName = path.basename(file);
  const sidecar = file.replace(/\.jsonl$/i, "");
  let hasSidecar = false;
  try {
    hasSidecar = fs.statSync(sidecar).isDirectory();
  } catch {
    hasSidecar = false;
  }
  const firstUser = parsed.firstUser.replace(/\s+/g, " ").trim().slice(0, 500);
  const title = parsed.title || deriveTitle(firstUser) || `会话 ${sessionIdFromName(fileName).slice(0, 8)}`;
  const cwd = parsed.cwd;
  return {
    key: encodeKey(agent, relpath),
    agent,
    relpath,
    fileName,
    title,
    cwd,
    project: projectLabel(cwd, relpath),
    sessionId: parsed.sessionId || sessionIdFromName(fileName),
    startedAt: parsed.startedAt || filenameTimestamp(fileName),
    updatedAt: new Date(stat.mtimeMs).toISOString(),
    mtime: stat.mtimeMs / 1000,
    size: stat.size,
    model: parsed.model,
    firstUser,
    parentPath: parsed.parentPath,
    parentKey: null,
    parentTitle: "",
    isChild: Boolean(parsed.parentPath) || relpath.split("/").length > 2,
    childCount: 0,
    hasSidecar,
    active: Date.now() - stat.mtimeMs < 5 * 60 * 1000,
  };
}

function walkSessions(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile() && /\.jsonl$/i.test(entry.name) && entry.name.toLowerCase() !== "changes.jsonl") {
        files.push(full);
      }
    }
  };
  visit(root);
  return files;
}

function countChildFiles(file: string): number {
  const stem = file.replace(/\.jsonl$/i, "");
  try {
    const info = fs.lstatSync(stem);
    if (info.isSymbolicLink() || !info.isDirectory()) return 0;
  } catch {
    return 0;
  }
  let count = 0;
  const visit = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && /\.jsonl$/i.test(entry.name) && entry.name.toLowerCase() !== "changes.jsonl") {
        count += 1;
      }
    }
  };
  visit(stem);
  return count;
}

export interface DiscoveryResult {
  sessions: SessionMeta[];
  roots: RootInfo[];
  scannedFiles: number;
  elapsedMs: number;
}

export function discoverSessions(): DiscoveryResult {
  const started = Date.now();
  const roots = getRoots();
  const sessions: SessionMeta[] = [];
  let scannedFiles = 0;

  for (const agent of Object.keys(roots) as Agent[]) {
    const root = roots[agent];
    if (!fs.existsSync(root)) continue;
    for (const file of walkSessions(root)) {
      scannedFiles += 1;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      let parsed: ParsedHead;
      try {
        parsed = readParsedHead(file);
      } catch {
        continue;
      }
      if (!parsed.isSession) continue;
      const relpath = safeRelative(root, file);
      sessions.push(buildMeta(agent, relpath, file, stat, parsed));
    }
  }

  const byPath = new Map<string, SessionMeta>();
  const normalized = sessions.map((session) => {
    const full = normalizePath(path.join(roots[session.agent], session.relpath));
    byPath.set(full, session);
    return { session, stem: full.replace(/\.jsonl$/i, "") };
  });

  for (const entry of normalized) {
    const { session } = entry;
    if (session.parentPath) {
      const parent = byPath.get(normalizePath(session.parentPath));
      if (parent) {
        session.parentKey = parent.key;
        session.parentTitle = parent.title;
      }
    }
    const prefix = `${entry.stem}/`;
    session.childCount = normalized.filter((other) => other.stem.startsWith(prefix)).length;
  }

  sessions.sort((a, b) => b.mtime - a.mtime);
  const counts: SessionCounts = {
    all: sessions.length,
    recent: sessions.filter((session) => Date.now() - session.mtime * 1000 < 7 * 24 * 3600 * 1000).length,
    children: sessions.filter((session) => session.isChild).length,
    active: sessions.filter((session) => session.active).length,
    agents: sessions.reduce<Record<string, number>>((acc, session) => {
      acc[session.agent] = (acc[session.agent] ?? 0) + 1;
      return acc;
    }, {}),
    totalSize: sessions.reduce((sum, session) => sum + session.size, 0),
  };
  const rootInfo = getRootInfo(counts.agents);
  return { sessions, roots: rootInfo, scannedFiles, elapsedMs: Date.now() - started };
}

export function filterSessions(
  sessions: SessionMeta[],
  options: { agent?: string; status?: SessionStatus; query?: string },
): SessionMeta[] {
  const query = (options.query ?? "").trim().toLowerCase();
  const now = Date.now();
  return sessions.filter((session) => {
    if (options.agent && options.agent !== "all" && session.agent !== options.agent) return false;
    if (options.status === "recent" && now - session.mtime * 1000 >= 7 * 24 * 3600 * 1000) return false;
    if (options.status === "children" && !session.isChild) return false;
    if (!query) return true;
    return [session.title, session.cwd, session.project, session.firstUser, session.sessionId]
      .join("\n")
      .toLowerCase()
      .includes(query);
  });
}

export function listSessions(options: { agent?: string; status?: SessionStatus; query?: string }): SessionListResponse {
  const discovery = discoverSessions();
  const agentSessions =
    options.agent && options.agent !== "all"
      ? discovery.sessions.filter((session) => session.agent === options.agent)
      : discovery.sessions;
  const filtered = filterSessions(agentSessions, { status: options.status, query: options.query });
  return {
    sessions: filtered,
    counts: {
      all: agentSessions.length,
      recent: agentSessions.filter((session) => Date.now() - session.mtime * 1000 < 7 * 24 * 3600 * 1000).length,
      children: agentSessions.filter((session) => session.isChild).length,
      active: agentSessions.filter((session) => session.active).length,
      agents: agentSessions.reduce<Record<string, number>>((acc, session) => {
        acc[session.agent] = (acc[session.agent] ?? 0) + 1;
        return acc;
      }, {}),
      totalSize: agentSessions.reduce((sum, session) => sum + session.size, 0),
    },
    roots: discovery.roots,
    elapsedMs: discovery.elapsedMs,
    scannedFiles: discovery.scannedFiles,
  };
}

export function getSessionDetail(key: string): SessionDetail {
  const resolved = resolveKey(key);
  const stat = fs.statSync(resolved.path);
  const parsed = readParsedHead(resolved.path);
  if (!parsed.isSession) throw new Error("该文件不是有效会话");
  const meta = buildMeta(resolved.agent, resolved.relpath, resolved.path, stat, parsed);
  meta.childCount = countChildFiles(resolved.path);
  if (meta.parentPath) {
    const parent = (() => {
      try {
        const absolute = path.isAbsolute(meta.parentPath)
          ? meta.parentPath
          : path.join(resolved.root, meta.parentPath);
        const rel = toPosix(path.relative(resolved.root, absolute));
        return resolveSessionPath(resolved.agent, rel);
      } catch {
        return null;
      }
    })();
    if (parent) {
      try {
        const parentParsed = readParsedHead(parent.path);
        meta.parentTitle = parentParsed.title || deriveTitle(parentParsed.firstUser);
        meta.parentKey = encodeKey(parent.agent, parent.relpath);
      } catch {
        // Parent may have been deleted; the child still remains readable.
      }
    }
  }

  const detail = buildDetail(resolved.path);
  const title = detail.title || meta.title;
  return {
    ...meta,
    title,
    sessionId: detail.sessionId || meta.sessionId,
    cwd: detail.cwd || meta.cwd,
    project: projectLabel(detail.cwd || meta.cwd, meta.relpath),
    model: detail.model || meta.model,
    parentPath: detail.parentPath || meta.parentPath,
    firstUser: meta.firstUser,
    items: detail.items,
    groups: detail.groups,
    prompts: detail.prompts,
    stats: detail.stats,
    resumeCommand: resumeCommand(resolved.agent, detail.sessionId || meta.sessionId, detail.cwd || meta.cwd),
    truncated: detail.truncated,
    filePath: resolved.path,
  };
}

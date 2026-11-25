import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { discoverSessions } from "./sessions";
import { getRoots } from "./config";
import { eventSearchSegments, parseEventLine } from "./parser";
import type { SearchResponse, SearchResult, SessionMeta } from "./types";

const SCAN_CONCURRENCY = 3;
const MAX_RESULTS = 80;
const MAX_HITS = 999;
const MAX_PARSE_LINE = 2_000_000;
const WORKER_THRESHOLD_BYTES = 8 * 1024 * 1024;

interface ScanChunk {
  files: string[];
  bytes: number;
}

function splitChunks(metas: SessionMeta[], count: number): ScanChunk[] {
  const chunks: ScanChunk[] = Array.from({ length: count }, () => ({ files: [], bytes: 0 }));
  for (const meta of [...metas].sort((a, b) => b.size - a.size)) {
    const target = chunks.reduce((smallest, chunk) => (chunk.bytes < smallest.bytes ? chunk : smallest), chunks[0]);
    target.files.push(path.join(getRoots()[meta.agent], meta.relpath));
    target.bytes += meta.size;
  }
  return chunks.filter((chunk) => chunk.files.length > 0);
}

function runScanWorker(chunk: ScanChunk, patterns: string[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(process.cwd(), "lib", "search-worker.mjs"), {
      workerData: { files: chunk.files, terms: patterns },
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error("检索分片超时"));
    }, 45_000);
    worker.once("message", (message: { matched?: unknown }) => {
      clearTimeout(timer);
      const matched = message && Array.isArray(message.matched)
        ? message.matched.filter((entry): entry is string => typeof entry === "string")
        : [];
      resolve(matched);
      void worker.terminate();
    });
    worker.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.once("exit", (code) => {
      if (code !== 0) {
        clearTimeout(timer);
        reject(new Error(`检索分片退出：${code}`));
      }
    });
  });
}

async function workerScan(metas: SessionMeta[], patterns: string[]): Promise<Set<string> | null> {
  const parallelism = Math.max(1, Math.min(4, os.availableParallelism?.() ?? os.cpus().length - 1));
  if (metas.length < 4 || parallelism < 2) return null;
  const chunks = splitChunks(metas, parallelism);
  try {
    const results = await Promise.all(chunks.map((chunk) => runScanWorker(chunk, patterns)));
    const matched = new Set<string>();
    const rootSet = new Set(metas.map((meta) => path.join(getRoots()[meta.agent], meta.relpath)));
    for (const list of results) {
      for (const file of list) if (rootSet.has(file)) matched.add(file);
    }
    return matched;
  } catch {
    return null;
  }
}

interface Term {
  source: string;
  regex: RegExp;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeTerm(value: string): Term {
  return { source: value, regex: new RegExp(escapeRegex(value), "i") };
}

function countOccurrences(source: string, term: Term): number {
  const regex = new RegExp(term.source, "gi");
  let count = 0;
  let match = regex.exec(source);
  while (match && count < MAX_HITS) {
    count += 1;
    if (match[0].length === 0) regex.lastIndex += 1;
    match = regex.exec(source);
  }
  return count;
}

function makeSnippet(text: string, term: Term, radius = 90): string {
  const match = term.regex.exec(text);
  if (!match) return "";
  const start = Math.max(0, match.index - radius);
  const end = Math.min(text.length, match.index + match[0].length + radius);
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}

function findSnippet(
  source: string,
  terms: Term[],
): { role: SearchResult["role"]; snippet: string } | null {
  for (const term of terms) {
    const regex = new RegExp(term.source, "gi");
    let attempts = 0;
    let match = regex.exec(source);
    while (match && attempts < 8) {
      const index = match.index;
      const lineStart = source.lastIndexOf("\n", index) + 1;
      const lineEndRaw = source.indexOf("\n", index);
      const lineEnd = lineEndRaw < 0 ? source.length : lineEndRaw;
      const line = source.slice(lineStart, lineEnd);
      if (line.length <= MAX_PARSE_LINE) {
        const event = parseEventLine(line);
        if (event) {
          for (const segment of eventSearchSegments(event)) {
            if (term.regex.test(segment.text)) {
              return { role: segment.role, snippet: makeSnippet(segment.text, term) };
            }
          }
        }
      } else {
        const snippet = makeSnippet(source.slice(Math.max(0, index - 120), Math.min(source.length, index + 120)), term);
        return { role: "event", snippet };
      }
      attempts += 1;
      regex.lastIndex = index + Math.max(1, match[0].length);
      match = regex.exec(source);
    }
  }
  const fallbackTerm = terms[0];
  const snippet = makeSnippet(source, fallbackTerm);
  return snippet ? { role: "event", snippet } : null;
}

function titleMatch(meta: SessionMeta, terms: Term[]): boolean {
  const haystack = [meta.title, meta.firstUser, meta.cwd, meta.project, meta.sessionId].join("\n");
  return terms.every((term) => term.regex.test(haystack));
}

async function scanSession(meta: SessionMeta, terms: Term[]): Promise<SearchResult | null> {
  let source: string;
  try {
    source = await fs.promises.readFile(path.join(getRoots()[meta.agent], meta.relpath), "utf8");
  } catch {
    return null;
  }
  if (!terms.every((term) => term.regex.test(source))) return null;
  const match = findSnippet(source, terms);
  if (!match) return null;
  return {
    sessionKey: meta.key,
    title: meta.title,
    agent: meta.agent,
    project: meta.project,
    cwd: meta.cwd,
    sessionId: meta.sessionId,
    role: match.role,
    snippet: match.snippet,
    ts: meta.updatedAt,
    hitCount: countOccurrences(source, terms[0]),
    titleMatch: titleMatch(meta, terms),
  };
}

export async function searchSessions(
  query: string,
  options: { agent?: string; limit?: number } = {},
): Promise<SearchResponse> {
  const started = Date.now();
  const trimmed = query.trim().slice(0, 200);
  if (trimmed.length < 2) {
    return { query: trimmed, results: [], scannedFiles: 0, scannedBytes: 0, elapsedMs: 0, truncated: false };
  }
  const terms = trimmed
    .split(/\s+/)
    .filter(Boolean)
    .map(makeTerm);
  const discovery = discoverSessions();
  const metas = discovery.sessions.filter(
    (meta) => !options.agent || options.agent === "all" || meta.agent === options.agent,
  );
  const byKey = new Map<string, SearchResult>();
  let titleCount = 0;

  for (const meta of metas) {
    if (!titleMatch(meta, terms)) continue;
    byKey.set(meta.key, {
      sessionKey: meta.key,
      title: meta.title,
      agent: meta.agent,
      project: meta.project,
      cwd: meta.cwd,
      sessionId: meta.sessionId,
      role: "title",
      snippet: meta.title || meta.firstUser || meta.cwd,
      ts: meta.updatedAt,
      hitCount: 1,
      titleMatch: true,
    });
    titleCount += 1;
  }

  const scannedFiles = metas.length;
  const scannedBytes = metas.reduce((sum, meta) => sum + meta.size, 0);
  const bodyTargets = metas.filter((meta) => !byKey.has(meta.key));
  const patterns = terms.map((term) => escapeRegex(term.source));
  let matchedFiles: Set<string> | null = null;
  if (scannedBytes >= WORKER_THRESHOLD_BYTES) {
    matchedFiles = await workerScan(bodyTargets, patterns);
  }

  const limit = Math.max(1, Math.min(options.limit ?? MAX_RESULTS, MAX_RESULTS));
  if (matchedFiles) {
    const candidates = bodyTargets
      .filter((meta) => matchedFiles.has(path.join(getRoots()[meta.agent], meta.relpath)))
      .slice(0, Math.max(0, limit - byKey.size));
    let cursor = 0;
    const pool = async () => {
      while (cursor < candidates.length) {
        const meta = candidates[cursor];
        cursor += 1;
        const result = await scanSession(meta, terms);
        if (result) byKey.set(meta.key, result);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, pool));
  } else {
    let cursor = 0;
    const worker = async () => {
      while (cursor < bodyTargets.length) {
        const meta = bodyTargets[cursor];
        cursor += 1;
        const result = await scanSession(meta, terms);
        if (result) byKey.set(meta.key, result);
      }
    };
    await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, bodyTargets.length) }, worker));
  }

  const ordered: SearchResult[] = [];
  for (const meta of metas) {
    const result = byKey.get(meta.key);
    if (result) ordered.push(result);
  }
  const totalMatches = matchedFiles ? titleCount + matchedFiles.size : byKey.size;
  return {
    query: trimmed,
    results: ordered.slice(0, limit),
    scannedFiles,
    scannedBytes,
    elapsedMs: Date.now() - started,
    truncated: totalMatches > limit,
  };
}

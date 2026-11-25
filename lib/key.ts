import fs from "node:fs";
import path from "node:path";
import { getRoots } from "./config";
import type { Agent } from "./types";

const AGENTS: Agent[] = ["pi", "omp"];

export function isAgent(value: string): value is Agent {
  return AGENTS.includes(value as Agent);
}

export function toPosix(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/");
}

export function normalizePath(value: string): string {
  let result = toPosix(value);
  try {
    result = toPosix(path.resolve(value));
  } catch {
    // Keep the slash-normalised value for non-file display strings.
  }
  return process.platform === "win32" ? result.toLowerCase() : result;
}

export function encodeKey(agent: Agent, relpath: string): string {
  return Buffer.from(`${agent}:${toPosix(relpath)}`, "utf8").toString("base64url");
}

export function decodeKey(key: string): { agent: Agent; relpath: string } {
  let decoded: string;
  try {
    decoded = Buffer.from(key, "base64url").toString("utf8");
  } catch {
    throw new Error("无效的会话标识");
  }
  const split = decoded.indexOf(":");
  if (split <= 0) throw new Error("无效的会话标识");
  const agent = decoded.slice(0, split);
  const relpath = decoded.slice(split + 1);
  if (!isAgent(agent)) throw new Error("不支持的 Agent");
  if (!relpath || relpath.includes("\0")) throw new Error("无效的会话路径");
  return { agent, relpath: toPosix(relpath) };
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export interface ResolvedSession {
  agent: Agent;
  relpath: string;
  path: string;
  root: string;
}

export function resolveSessionPath(agent: Agent, relpath: string): ResolvedSession {
  const root = getRoots()[agent];
  if (!fs.existsSync(root)) throw new Error(`${agent} 会话目录不存在：${root}`);
  const rootReal = fs.realpathSync(root);
  const posix = toPosix(relpath).replace(/^\/+/, "");
  const parts = posix.split("/");
  if (!posix || parts.some((part) => part === "" || part === "." || part === ".." || part.includes(":"))) {
    throw new Error("会话路径越界");
  }
  const full = path.resolve(rootReal, ...parts);
  if (!isInside(rootReal, full)) throw new Error("会话路径越界");
  let lstat: fs.Stats;
  try {
    lstat = fs.lstatSync(full);
  } catch {
    throw new Error("会话文件不存在");
  }
  if (!lstat.isFile() || lstat.isSymbolicLink()) throw new Error("拒绝访问非普通会话文件");
  const real = fs.realpathSync(full);
  if (!isInside(rootReal, real)) throw new Error("会话符号链接越界");
  if (!/\.jsonl$/i.test(real)) throw new Error("不是会话 JSONL 文件");
  if (path.basename(real).toLowerCase() === "changes.jsonl") throw new Error("不是会话正文文件");
  return { agent, relpath: posix, path: real, root: rootReal };
}

export function resolveKey(key: string): ResolvedSession {
  const { agent, relpath } = decodeKey(key);
  return resolveSessionPath(agent, relpath);
}

export function readFileHead(file: string, bytes: number): string {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const stats = fs.fstatSync(fd);
    const length = Math.max(0, Math.min(bytes, stats.size));
    const buffer = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const chunk = fs.readSync(fd, buffer, read, length - read, read);
      if (chunk <= 0) break;
      read += chunk;
    }
    return buffer.subarray(0, read).toString("utf8");
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close errors; the caller will surface read failures.
      }
    }
  }
}

export function safeRelative(root: string, file: string): string {
  return toPosix(path.relative(root, file));
}

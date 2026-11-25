import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Agent, RootInfo } from "./types";

export const APP_VERSION = "1.0.0";
export const APP_NAME = "Agent 会话管理";

function expand(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.resolve(os.homedir(), value.slice(2));
  }
  return path.resolve(value);
}

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

function piRoot(): string {
  const direct = firstEnv("ASM_PI_ROOT", "PI_CODING_AGENT_SESSION_DIR");
  if (direct) return expand(direct);
  const agentDir = firstEnv("PI_CODING_AGENT_DIR");
  if (agentDir) {
    const base = expand(agentDir);
    return base.endsWith(path.sep + "sessions") ? base : path.join(base, "sessions");
  }
  return path.join(os.homedir(), ".pi", "agent", "sessions");
}

function ompRoot(): string {
  const direct = firstEnv("ASM_OMP_ROOT", "OMP_SESSION_DIR");
  if (direct) return expand(direct);
  const home = firstEnv("OMP_HOME");
  if (home) {
    const base = expand(home);
    if (base.endsWith(path.sep + "sessions")) return base;
    const nested = path.join(base, "agent", "sessions");
    if (fs.existsSync(nested)) return nested;
    return path.join(base, "sessions");
  }
  return path.join(os.homedir(), ".omp", "agent", "sessions");
}

export function getRoots(): Record<Agent, string> {
  return { pi: piRoot(), omp: ompRoot() };
}

export function getRootInfo(counts: Record<string, number>): RootInfo[] {
  const roots = getRoots();
  return (Object.keys(roots) as Agent[]).map((agent) => ({
    agent,
    label: agent,
    path: roots[agent],
    exists: fs.existsSync(roots[agent]),
    sessionCount: counts[agent] ?? 0,
  }));
}

export const MAX_HEAD_BYTES = 640 * 1024;
export const INITIAL_HEAD_BYTES = 64 * 1024;

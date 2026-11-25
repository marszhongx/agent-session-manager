import fs from "node:fs";
import path from "node:path";
import { resolveKey } from "./key";
import type { DeleteResult } from "./types";

const ACTIVE_WINDOW_MS = 30_000;
const MAX_KEYS = 500;

interface Target {
  key: string;
  path: string;
  root: string;
  sidecar: string;
  sidecarExists: boolean;
}

function assertSafeSidecar(target: Target): void {
  const lstat = fs.lstatSync(target.sidecar);
  if (lstat.isSymbolicLink() || !lstat.isDirectory()) {
    throw new Error("侧车目录不是普通目录，拒绝清理");
  }
  const real = fs.realpathSync(target.sidecar);
  const relative = path.relative(target.root, real);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("侧车目录越界，拒绝清理");
  }
}

function walkFiles(dir: string): string[] {
  const files: string[] = [];
  const visit = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  visit(dir);
  return files;
}

function assertNotActive(file: string): void {
  const stat = fs.statSync(file);
  if (Date.now() - stat.mtimeMs < ACTIVE_WINDOW_MS) {
    throw new Error("会话刚刚被写入，可能仍在运行；请先退出对应 Agent，等待 30 秒后重试");
  }
}

export function deleteSessions(keys: string[], cascade: boolean): DeleteResult {
  if (!Array.isArray(keys) || keys.length === 0) throw new Error("未选择会话");
  if (keys.length > MAX_KEYS) throw new Error(`单次最多清理 ${MAX_KEYS} 个会话`);

  const targets: Target[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const resolved = resolveKey(key);
    const stat = fs.lstatSync(resolved.path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("目标不是普通会话文件");
    if (Date.now() - stat.mtimeMs < ACTIVE_WINDOW_MS) {
      throw new Error("会话刚刚被写入，可能仍在运行；请先退出对应 Agent，等待 30 秒后重试");
    }
    const sidecar = resolved.path.replace(/\.jsonl$/i, "");
    const sidecarExists = fs.existsSync(sidecar);
    const target: Target = { key, path: resolved.path, root: resolved.root, sidecar, sidecarExists };
    if (cascade && sidecarExists) {
      assertSafeSidecar(target);
      for (const file of walkFiles(sidecar)) assertNotActive(file);
    }
    targets.push(target);
  }

  const skipped = new Set<string>();
  if (cascade) {
    for (const parent of targets) {
      if (!parent.sidecarExists) continue;
      for (const child of targets) {
        if (child.key === parent.key) continue;
        if (child.path.startsWith(parent.sidecar + path.sep)) skipped.add(child.key);
      }
    }
  }

  const result: DeleteResult = { deleted: [], errors: [] };
  for (const target of targets) {
    if (skipped.has(target.key)) continue;
    try {
      assertNotActive(target.path);
      // Remove the sidecar first: if the main file cannot be deleted, the
      // session is still discoverable and the cleanup can be retried.
      if (cascade && target.sidecarExists && fs.existsSync(target.sidecar)) {
        assertSafeSidecar(target);
        fs.rmSync(target.sidecar, { recursive: true, force: true });
      }
      fs.rmSync(target.path, { force: true });
      result.deleted.push(target.key);
    } catch (error) {
      result.errors.push({
        key: target.key,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

import fs from "node:fs";
import { diffLines } from "diff";
import { isObject } from "./guards";
import type {
  DetailStats,
  DiffLine,
  GroupMeta,
  PromptRef,
  SessionDetail,
  TimelineItem,
  ToolDiff,
  ToolResult,
} from "./types";

const MAX_THINKING = 120_000;
const MAX_TEXT = 300_000;
const MAX_TOOL_ARG = 48_000;
const MAX_TOOL_RESULT = 60_000;
const MAX_DIFF_LINES = 600;
const MAX_ITEMS = 20_000;
const MAX_DETAIL_BUDGET = 24_000_000;

const PRIVATE_USE = /\p{Co}/gu;
const SYSTEM_REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/gi;
const FILE_TAG = /<file\s+[^>]*>([\s\S]*?)<\/file>/gi;
const SAFE_ID = /^[A-Za-z0-9._:\-]+$/;

type JsonObject = Record<string, unknown>;

export function parseTimestamp(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  try {
    if (typeof value === "number" && Number.isFinite(value)) {
      const millis = Math.abs(value) > 10_000_000_000 ? value : value * 1000;
      return new Date(millis).toISOString();
    }
    let raw = String(value).trim();
    if (raw.endsWith("Z")) raw = raw.slice(0, -1) + "+00:00";
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString();
  } catch {
    return "";
  }
}

export function eventTime(event: JsonObject): string {
  const message = isObject(event.message) ? event.message : undefined;
  const stamp = event.timestamp ?? event.updatedAt ?? event.at ?? message?.timestamp;
  return parseTimestamp(stamp);
}

export function cleanTitle(value: unknown): string {
  return String(value ?? "")
    .replace(PRIVATE_USE, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

export function deriveTitle(value: unknown): string {
  let text = String(value ?? "");
  text = text.replace(SYSTEM_REMINDER, "");
  text = text.replace(FILE_TAG, "$1");
  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text.replace(/^[\s\-—:：,，.。]+|[\s\-—:：,，.。]+$/g, "").slice(0, 80);
}

export function projectLabel(cwd: string, relpath: string): string {
  if (cwd) {
    const cleaned = cwd.replace(/\//g, "\\").replace(/\\+$/, "");
    const name = cleaned.split("\\").pop();
    if (name) return name;
  }
  const head = relpath.split("/")[0].replace(/^-+|-+$/g, "");
  const tail = head.split("-").pop();
  return tail || "未归类";
}

export function resumeCommand(agent: string, sessionId: string, cwd: string): string | null {
  if (!sessionId || !SAFE_ID.test(sessionId)) return null;
  const quoted = (cwd || "").replace(/"/g, '\\"');
  const command = agent === "pi" ? `pi --session ${sessionId}` : `omp --resume=${sessionId}`;
  return quoted ? `cd "${quoted}" && ${command}` : command;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function contentBlocks(message: JsonObject): JsonObject[] {
  const content = message.content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) return content.filter(isObject);
  return [];
}

export function messageText(message: JsonObject): { text: string; images: number } {
  if (typeof message.content === "string") return { text: message.content, images: 0 };
  const texts: string[] = [];
  let images = 0;
  for (const block of contentBlocks(message)) {
    if (block.type === "text") texts.push(asString(block.text));
    else if (block.type === "image") images += 1;
  }
  let text = texts.filter(Boolean).join("\n\n");
  if (images > 0) {
    text = text
      .replace(/<file\s+[^>]*>\s*\[Image[^\]]*\]\s*<\/file>/gi, "")
      .replace(/\[Image #?\d+[^\]]*\]/gi, "")
      .trim();
  }
  return { text, images };
}

function thinkingText(block: JsonObject): string {
  return asString(block.thinking ?? block.text ?? block.reasoning);
}

function toolTarget(args: unknown): string {
  if (!isObject(args)) return String(args ?? "").slice(0, 180);
  for (const key of ["path", "file_path", "filePath", "filename", "target", "notebook_path"]) {
    const value = args[key];
    if (typeof value === "string" && value) return value.slice(0, 220);
  }
  const command = asString(args.command ?? args.cmd ?? args.script);
  if (command) {
    const first = command.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
    return first.slice(0, 220);
  }
  const pattern = asString(args.pattern ?? args.query ?? args.q);
  if (pattern) {
    const extra = asString(args.path ?? args.glob);
    return `${pattern}${extra ? `  ${extra}` : ""}`.slice(0, 220);
  }
  const url = asString(args.url);
  if (url) return url.slice(0, 220);
  for (const value of Object.values(args)) {
    if (typeof value === "string" && value) return value.slice(0, 220);
  }
  return "";
}

export function toolLabel(name: string): string {
  const mapping: Record<string, string> = {
    bash: "Bash",
    shell: "Shell",
    read: "Read",
    write: "Write",
    edit: "Update",
    grep: "Grep",
    rg: "Grep",
    glob: "Glob",
    ls: "List",
    web_search: "Web Search",
    webfetch: "Web Fetch",
    todo: "Todo",
    task: "Agent",
    eval: "Eval",
    apply_patch: "Patch",
  };
  return mapping[name.toLowerCase()] ?? name;
}

function markerText(event: JsonObject): string {
  for (const key of ["summary", "text", "content", "message"]) {
    const value = event[key];
    if (typeof value === "string" && value.trim()) return value;
    if (isObject(value)) {
      const nested = value.text ?? value.content;
      if (typeof nested === "string" && nested.trim()) return nested;
    }
  }
  return "";
}

function trimValue(value: unknown, limit: number, depth = 0): unknown {
  if (depth > 5) return "…";
  if (typeof value === "string") {
    return value.length <= limit ? value : `${value.slice(0, limit)}\n…`;
  }
  if (Array.isArray(value)) return value.slice(0, 200).map((entry) => trimValue(entry, limit, depth + 1));
  if (isObject(value)) {
    const result: JsonObject = {};
    for (const [key, entry] of Object.entries(value).slice(0, 120)) {
      result[key] = trimValue(entry, limit, depth + 1);
    }
    return result;
  }
  return value;
}

export function makeDiff(path: string, oldText: string, newText: string, mode: "edit" | "write"): ToolDiff {
  const oldValue = oldText.length > 300_000 ? oldText.slice(0, 300_000) : oldText;
  const newValue = newText.length > 300_000 ? newText.slice(0, 300_000) : newText;
  const changes = diffLines(oldValue, newValue);
  const lines: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  let additions = 0;
  let deletions = 0;
  let truncated = false;

  for (const change of changes) {
    const rawLines = change.value.split("\n");
    if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") rawLines.pop();
    for (const text of rawLines) {
      if (lines.length >= MAX_DIFF_LINES) {
        truncated = true;
        break;
      }
      if (change.added) {
        lines.push({ type: "add", new: newLine, text });
        newLine += 1;
        additions += 1;
      } else if (change.removed) {
        lines.push({ type: "del", old: oldLine, text });
        oldLine += 1;
        deletions += 1;
      } else {
        lines.push({ type: "ctx", old: oldLine, new: newLine, text });
        oldLine += 1;
        newLine += 1;
      }
    }
    if (truncated) break;
  }
  return { path, mode, lines, additions, deletions, truncated };
}

export function toolDiff(name: string, args: unknown): ToolDiff | null {
  if (!isObject(args)) return null;
  const lowered = name.toLowerCase();
  const path = asString(args.path ?? args.file_path ?? args.filePath);
  if (lowered === "edit" || lowered.includes("str_replace") || lowered.includes("replace")) {
    const oldText = args.old_string ?? args.oldText ?? args.old;
    const newText = args.new_string ?? args.newText ?? args.new;
    if (typeof oldText === "string" && typeof newText === "string") {
      return makeDiff(path, oldText, newText, "edit");
    }
  }
  if (lowered === "write" || lowered === "create" || lowered === "save") {
    const content = args.content ?? args.text;
    if (typeof content === "string") return makeDiff(path, "", content, "write");
  }
  if ((lowered === "apply_patch" || lowered === "patch") && typeof args.patch === "string") {
    return {
      path: path || "patch",
      mode: "patch",
      lines: [],
      patch: args.patch.slice(0, 120_000),
      additions: 0,
      deletions: 0,
      truncated: false,
    };
  }
  return null;
}

export function parseEventLine(line: string): JsonObject | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export interface SearchSegment {
  role: "title" | "user" | "assistant" | "thinking" | "tool" | "result" | "event";
  text: string;
}

export function eventSearchSegments(event: JsonObject): SearchSegment[] {
  const kind = asString(event.type);
  if (kind === "title" || kind === "title_change") {
    const title = cleanTitle(event.title);
    return title ? [{ role: "title", text: title }] : [];
  }
  if (kind === "session") {
    const cwd = asString(event.cwd);
    return cwd ? [{ role: "event", text: cwd }] : [];
  }
  if (kind === "compaction" || kind === "branch_summary") {
    return [{ role: "event", text: markerText(event) }];
  }
  if (kind !== "message" || !isObject(event.message)) return [];
  const message = event.message;
  const role = asString(message.role);
  if (role === "user") {
    const { text, images } = messageText(message);
    return [{ role: "user", text: text || (images ? "[图片]" : "") }];
  }
  if (role === "toolResult") {
    const { text } = messageText(message);
    return [{ role: "result", text }];
  }
  if (role !== "assistant") return [];
  const segments: SearchSegment[] = [];
  for (const block of contentBlocks(message)) {
    if (block.type === "text") {
      const text = asString(block.text);
      if (text.trim()) segments.push({ role: "assistant", text });
    } else if (block.type === "thinking") {
      const text = thinkingText(block);
      if (text.trim()) segments.push({ role: "thinking", text });
    } else if (block.type === "toolCall") {
      const name = asString(block.name) || "tool";
      const target = toolTarget(block.arguments);
      let argsText = "";
      try {
        argsText = JSON.stringify(block.arguments ?? {});
      } catch {
        argsText = "";
      }
      segments.push({ role: "tool", text: `${name} ${target}\n${argsText.slice(0, 20_000)}` });
    }
  }
  return segments;
}

export interface DetailResult {
  title: string;
  sessionId: string;
  cwd: string;
  parentPath: string;
  model: string;
  items: TimelineItem[];
  groups: Record<string, GroupMeta>;
  prompts: PromptRef[];
  stats: DetailStats;
  truncated: boolean;
}

class DetailBuilder {
  items: TimelineItem[] = [];
  groups: Record<string, GroupMeta> = {};
  calls = new Map<string, TimelineItem>();
  prompts: PromptRef[] = [];
  index = 0;
  budget = MAX_DETAIL_BUDGET;
  truncated = false;
  title = "";
  sessionId = "";
  cwd = "";
  parentPath = "";
  model = "";
  stats: DetailStats = {
    turns: 0,
    messages: 0,
    toolCalls: 0,
    thinkingChars: 0,
    totalTokens: 0,
    totalCost: 0,
    durationMs: 0,
    startedAt: "",
    lastEventAt: "",
  };

  private cut(value: unknown, limit: number): string {
    let text = String(value ?? "");
    if (text.length > limit) {
      text = `${text.slice(0, limit)}\n…`;
      this.truncated = true;
    }
    if (this.budget <= 0) {
      this.truncated = true;
      return "";
    }
    this.budget -= text.length;
    if (this.budget < 0) this.truncated = true;
    return text;
  }

  private emit(type: TimelineItem["type"], ts: string, data: Partial<TimelineItem>): TimelineItem | null {
    if (this.index >= MAX_ITEMS) {
      this.truncated = true;
      return null;
    }
    const item: TimelineItem = { i: this.index, type, ts, ...data };
    this.items.push(item);
    this.index += 1;
    return item;
  }

  private touch(ts: string): void {
    if (ts && (!this.stats.lastEventAt || ts > this.stats.lastEventAt)) {
      this.stats.lastEventAt = ts;
    }
  }

  feed(event: JsonObject): void {
    if (this.index >= MAX_ITEMS) {
      this.truncated = true;
      return;
    }
    const ts = eventTime(event);
    this.touch(ts);
    const kind = asString(event.type);
    if (kind === "title" || kind === "title_change") {
      const title = cleanTitle(event.title);
      if (title) this.title = title;
      return;
    }
    if (kind === "session") {
      this.sessionId = asString(event.id) || this.sessionId;
      this.cwd = asString(event.cwd) || this.cwd;
      this.parentPath = asString(event.parentSession) || this.parentPath;
      this.stats.startedAt = parseTimestamp(event.timestamp) || this.stats.startedAt;
      return;
    }
    if (kind === "model_change") {
      this.model = asString(event.model ?? event.modelId) || this.model;
      return;
    }
    if (kind === "message") {
      this.message(event, ts);
      return;
    }
    if (kind === "compaction" || kind === "branch_summary") {
      const label = kind === "compaction" ? "上下文已压缩" : "分支摘要";
      this.emit("event", ts, { label, text: this.cut(markerText(event), MAX_TEXT) });
    }
  }

  private message(event: JsonObject, ts: string): void {
    const message = event.message;
    if (!isObject(message)) return;
    const role = asString(message.role);
    if (role === "user") {
      const { text, images } = messageText(message);
      if (!text.trim() && !images) return;
      const item = this.emit("user", ts, {
        text: this.cut(text, MAX_TEXT),
        images,
        chars: text.length,
      });
      this.stats.turns += 1;
      this.stats.messages += 1;
      if (item && text.trim()) {
        this.prompts.push({ i: item.i, ts, text: deriveTitle(text).slice(0, 120) });
      }
      return;
    }
    if (role === "toolResult") {
      this.toolResult(message);
      return;
    }
    if (role !== "assistant") return;

    this.stats.messages += 1;
    const usage = isObject(message.usage) ? message.usage : {};
    const cost = isObject(usage.cost) ? usage.cost : {};
    const tokens = Number(usage.totalTokens ?? 0);
    const costTotal = Number(cost.total ?? 0);
    if (Number.isFinite(tokens)) this.stats.totalTokens += tokens;
    if (Number.isFinite(costTotal)) this.stats.totalCost += costTotal;
    const durationRaw = message.durationMs ?? message.duration ?? 0;
    const duration = Number(durationRaw);
    if (Number.isFinite(duration)) this.stats.durationMs += Math.max(0, duration);
    const messageModel = asString(message.model);
    if (messageModel) this.model = messageModel;

    const groupId = asString(event.id) || `g${this.index}`;
    if (!this.groups[groupId]) {
      this.groups[groupId] = {
        id: groupId,
        ts,
        model: messageModel,
        provider: asString(message.provider),
        durationMs: Number.isFinite(duration) ? Math.max(0, Math.round(duration)) : 0,
        tokens: Number.isFinite(tokens) ? Math.round(tokens) : 0,
        cost: Number.isFinite(costTotal) ? costTotal : 0,
      };
    }

    for (const block of contentBlocks(message)) {
      if (block.type === "thinking") {
        const text = thinkingText(block);
        const signature = Boolean(block.thinkingSignature);
        if (!text && !signature) continue;
        const value = text || "思考内容不可见";
        this.stats.thinkingChars += text.length;
        this.emit("thinking", ts, {
          group: groupId,
          text: this.cut(value, MAX_THINKING),
          chars: text.length,
          hidden: !text,
        });
      } else if (block.type === "text") {
        const text = asString(block.text);
        if (!text.trim()) continue;
        this.emit("assistant", ts, {
          group: groupId,
          text: this.cut(text, MAX_TEXT),
          chars: text.length,
        });
      } else if (block.type === "toolCall") {
        const name = asString(block.name) || "tool";
        const args = block.arguments;
        const callId = asString(block.id) || `call${this.index}`;
        const target = toolTarget(args);
        this.stats.toolCalls += 1;
        const item = this.emit("tool", ts, {
          group: groupId,
          callId,
          name,
          label: toolLabel(name),
          target,
          args: trimValue(args, MAX_TOOL_ARG),
          diff: toolDiff(name, args),
        });
        if (item) this.calls.set(callId, item);
      }
    }
  }

  private toolResult(message: JsonObject): void {
    const callId = asString(message.toolCallId);
    const name = asString(message.toolName);
    let item = this.calls.get(callId);
    if (!item) {
      for (let i = this.items.length - 1; i >= 0; i -= 1) {
        const candidate = this.items[i];
        if (candidate.type === "tool" && candidate.name === name && !candidate.result) {
          item = candidate;
          break;
        }
      }
    }
    if (!item) return;
    let { text, images } = messageText(message);
    const details = message.details;
    if (!text.trim() && isObject(details) && isObject(details.displayContent)) {
      text = asString(details.displayContent.text);
    }
    const original = text.length;
    const clipped = this.cut(text, MAX_TOOL_RESULT);
    const result: ToolResult = {
      text: clipped,
      chars: original,
      truncated: clipped.length < original,
      isError: Boolean(message.isError),
      images,
    };
    item.result = result;
  }

  finish(): DetailResult {
    if (this.truncated && this.index < MAX_ITEMS) {
      this.emit("event", "", {
        label: "内容过长",
        text: "会话超过阅读器单次加载上限，后续内容已截断。",
      });
    }
    return {
      title: cleanTitle(this.title),
      sessionId: this.sessionId,
      cwd: this.cwd,
      parentPath: this.parentPath,
      model: this.model,
      items: this.items,
      groups: this.groups,
      prompts: this.prompts,
      stats: { ...this.stats, totalCost: Number(this.stats.totalCost.toFixed(8)) },
      truncated: this.truncated,
    };
  }
}

export function buildDetail(file: string): DetailResult {
  const builder = new DetailBuilder();
  const source = fs.readFileSync(file, "utf8");
  for (const line of source.split(/\r?\n/)) {
    const event = parseEventLine(line);
    if (event) builder.feed(event);
  }
  return builder.finish();
}

export function detailToMarkdown(detail: SessionDetail, options: { thinking: boolean; tools: boolean }): string {
  const lines: string[] = [];
  lines.push(`# ${detail.title || "未命名会话"}`);
  lines.push("");
  lines.push(`- Agent：${detail.agent}`);
  lines.push(`- 会话 ID：${detail.sessionId || "—"}`);
  lines.push(`- 项目：${detail.cwd || "—"}`);
  lines.push(`- 模型：${detail.model || "—"}`);
  lines.push(`- 开始：${detail.stats.startedAt || "—"}`);
  lines.push(`- 文件：${detail.filePath}`);
  lines.push("");
  lines.push("---", "");

  for (const item of detail.items) {
    if (item.type === "user") {
      lines.push("## 用户", "", item.text || "", "");
    } else if (item.type === "assistant") {
      const group = item.group ? detail.groups[item.group] : undefined;
      lines.push(`## 助手${group?.model ? ` · ${group.model}` : ""}`, "", item.text || "", "");
    } else if (item.type === "thinking") {
      if (!options.thinking) continue;
      lines.push("<details>", `<summary>思考 · ${item.chars ?? 0} 字</summary>`, "", item.text || "", "", "</details>", "");
    } else if (item.type === "tool") {
      if (!options.tools) continue;
      lines.push(`### 工具 · ${item.name || "tool"} ${item.target || ""}`.trim(), "");
      if (item.args) {
        lines.push("```json", JSON.stringify(item.args, null, 2), "```", "");
      }
      if (item.diff) {
        if (item.diff.mode === "patch") {
          lines.push("```diff", item.diff.patch ?? "", "```", "");
        } else {
          lines.push("```diff");
          for (const line of item.diff.lines) {
            const prefix = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
            lines.push(prefix + line.text);
          }
          lines.push("```", "");
        }
      }
      if (item.result) {
        lines.push("**结果**", "", "```text", item.result.text || "(空)", "```", "");
      }
    } else if (item.type === "event") {
      lines.push(`> ${item.label || "事件"}${item.text ? `：${item.text}` : ""}`, "");
    }
  }
  return lines.join("\n");
}

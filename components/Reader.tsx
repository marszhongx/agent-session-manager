"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Brain,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Coins,
  Cpu,
  Download,
  FileText,
  Folder,
  HardDrive,
  Hash,
  ListTree,
  Menu,
  Sparkles,
  Terminal,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import Markdown from "./Markdown";
import ToolCard from "./ToolCard";
import type { FocusMode, GroupMeta, PromptRef, SessionDetail, TimelineItem } from "@/lib/types";
import {
  agentLabel,
  formatBytes,
  formatCost,
  formatDateTime,
  formatDuration,
  formatRelativeTime,
  formatTokens,
} from "@/lib/format";

interface ReaderProps {
  detail: SessionDetail | null;
  loading: boolean;
  error: string | null;
  focus: FocusMode;
  setFocus: (value: FocusMode) => void;
  hideThinking: boolean;
  setHideThinking: (value: boolean) => void;
  hideTools: boolean;
  setHideTools: (value: boolean) => void;
  collapseProcess: boolean;
  setCollapseProcess: (value: boolean) => void;
  outlineOpen: boolean;
  setOutlineOpen: (value: boolean) => void;
  highlightQuery: string;
  onDelete: () => void;
  onToast: (message: string) => void;
  onMenu: () => void;
  onOpenSession: (key: string) => void;
}

type Block =
  | { kind: "user"; item: TimelineItem }
  | { kind: "assistant"; id: string; items: TimelineItem[] }
  | { kind: "event"; item: TimelineItem };

function buildBlocks(items: TimelineItem[]): Block[] {
  const blocks: Block[] = [];
  const groups = new Map<string, Extract<Block, { kind: "assistant" }>>();
  for (const item of items) {
    if (item.type === "user") {
      blocks.push({ kind: "user", item });
    } else if (item.type === "event") {
      blocks.push({ kind: "event", item });
    } else if (item.group) {
      let group = groups.get(item.group);
      if (!group) {
        group = { kind: "assistant", id: item.group, items: [] };
        groups.set(item.group, group);
        blocks.push(group);
      }
      group.items.push(item);
    }
  }
  return blocks;
}

function AgentAvatar({ agent, size = 30 }: { agent: string; size?: number }) {
  return (
    <span className={`agent-avatar ${agent}`} style={{ width: size, height: size }} aria-hidden>
      {agent === "pi" ? "π" : "o"}
    </span>
  );
}

function SessionMetaBar({
  detail,
  onToast,
  onOpenSession,
}: {
  detail: SessionDetail;
  onToast: (message: string) => void;
  onOpenSession: (key: string) => void;
}) {
  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      onToast(`${label}已复制`);
    } catch {
      onToast("复制失败，请手动选择");
    }
  };
  return (
    <div className="session-meta">
      <span className="meta-chip" title={formatDateTime(detail.updatedAt)}>
        <Clock size={13} />
        {formatRelativeTime(detail.updatedAt)}
      </span>
      <button
        type="button"
        className="meta-chip clickable"
        title="复制完整会话 ID"
        onClick={() => copy(detail.sessionId, "会话 ID ")}
      >
        <Hash size={13} />
        {detail.sessionId ? detail.sessionId.slice(0, 8) : "—"}
      </button>
      <button
        type="button"
        className="meta-chip clickable"
        title={`${detail.cwd}\n点击复制工作目录`}
        onClick={() => copy(detail.cwd, "工作目录")}
      >
        <Folder size={13} />
        {detail.cwd || "—"}
      </button>
      <span className="meta-chip" title={detail.filePath}>
        <FileText size={13} />
        {detail.fileName}
      </span>
      <span className="meta-chip">
        <Cpu size={13} />
        {detail.model || "未知模型"}
      </span>
      <span className="meta-chip">
        <HardDrive size={13} />
        {formatBytes(detail.size)}
      </span>
      {detail.stats.totalTokens > 0 ? (
        <span className="meta-chip">
          <Sparkles size={13} />
          {formatTokens(detail.stats.totalTokens)} tokens
        </span>
      ) : null}
      {detail.stats.totalCost > 0 ? (
        <span className="meta-chip">
          <Coins size={13} />
          {formatCost(detail.stats.totalCost)}
        </span>
      ) : null}
      {detail.stats.durationMs > 0 ? (
        <span className="meta-chip">
          <Clock size={13} />
          {formatDuration(detail.stats.durationMs)}
        </span>
      ) : null}
      {detail.isChild ? (
        <span className="badge child">
          子会话
          {detail.parentTitle ? (
            <button
              type="button"
              className="badge-link"
              onClick={() => detail.parentKey && onOpenSession(detail.parentKey)}
            >
              {detail.parentTitle}
              <ArrowUpRight size={11} />
            </button>
          ) : null}
        </span>
      ) : null}
      {detail.childCount > 0 ? <span className="badge">含 {detail.childCount} 个子会话</span> : null}
      {detail.active ? <span className="badge live">活跃</span> : null}
    </div>
  );
}

function matchesQuery(item: TimelineItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  const args = item.args ? JSON.stringify(item.args) : "";
  return [item.text, item.target, item.result?.text, args]
    .filter(Boolean)
    .join("\n")
    .toLowerCase()
    .includes(needle);
}

function ThinkingRow({ item, forceOpen }: { item: TimelineItem; forceOpen: boolean }) {
  const preview = (item.text ?? "").replace(/\s+/g, " ").trim().slice(0, 96);
  return (
    <details className="thinking" open={forceOpen || undefined}>
      <summary>
        <span className="thinking-icon">
          <Sparkles size={13} />
        </span>
        <span className="thinking-label">{item.hidden ? "思考内容不可见" : "思考中…"}</span>
        <span className="thinking-preview">{preview}</span>
        <span className="thinking-count">{item.chars?.toLocaleString() ?? 0} 字</span>
      </summary>
      <div className="thinking-body">{item.text || "该 Agent 未保存可读的思考正文。"}</div>
    </details>
  );
}

function ProcessBlock({
  items,
  meta,
  collapseAll,
  hiddenCount,
  firstMatch,
}: {
  items: TimelineItem[];
  meta?: GroupMeta;
  collapseAll: boolean;
  hiddenCount: number;
  firstMatch: number;
}) {
  const [open, setOpen] = useState(!collapseAll);
  useEffect(() => setOpen(!collapseAll), [collapseAll]);
  if (items.length === 0) return null;
  const commands = items.filter((item) => item.type === "tool" && /bash|shell/i.test(item.name ?? "")).length;
  const files = new Set(
    items
      .filter((item) => item.type === "tool" && item.diff?.path)
      .map((item) => item.diff?.path)
      .filter(Boolean),
  ).size;
  const pieces = [`${items.length} 步`];
  if (commands) pieces.push(`${commands} 个命令`);
  if (files) pieces.push(`改了 ${files} 个文件`);
  if (hiddenCount) pieces.push(`已隐藏 ${hiddenCount} 项`);
  if (meta?.durationMs) pieces.push(formatDuration(meta.durationMs));
  return (
    <div className={`process ${open ? "open" : ""}`}>
      <button type="button" className="process-head" onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>执行过程</span>
        <span className="process-meta">{pieces.join(" · ")}</span>
      </button>
      {open ? (
        <div className="process-body">
          {items.map((item) =>
            item.type === "thinking" ? (
              <ThinkingRow key={item.i} item={item} forceOpen={item.i === firstMatch} />
            ) : (
              <ToolCard key={item.i} item={item} forceOpen={item.i === firstMatch} />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

function AssistantGroup({
  block,
  meta,
  detail,
  focus,
  hideThinking,
  hideTools,
  collapseProcess,
  firstMatch,
}: {
  block: Extract<Block, { kind: "assistant" }>;
  meta?: GroupMeta;
  detail: SessionDetail;
  focus: FocusMode;
  hideThinking: boolean;
  hideTools: boolean;
  collapseProcess: boolean;
  firstMatch: number;
}) {
  const allProcess = block.items.filter((item) => item.type === "thinking" || item.type === "tool");
  let toggledProcess = allProcess;
  if (hideThinking) toggledProcess = toggledProcess.filter((item) => item.type !== "thinking");
  if (hideTools) toggledProcess = toggledProcess.filter((item) => item.type !== "tool");
  const visibleProcess =
    focus === "changes" ? toggledProcess.filter((item) => item.type === "tool" && item.diff) : toggledProcess;
  const textItems = focus === "changes" ? [] : block.items.filter((item) => item.type === "assistant");
  if (focus === "chat") {
    if (textItems.length === 0) return null;
  } else if (focus === "changes") {
    if (visibleProcess.length === 0) return null;
  } else if (textItems.length === 0 && visibleProcess.length === 0) {
    return null;
  }
  return (
    <article className="assistant-turn">
      <header className="assistant-head">
        <AgentAvatar agent={detail.agent} />
        <span className="assistant-name">{agentLabel(detail.agent)}</span>
        <span className="assistant-time">{formatRelativeTime(block.items[0]?.ts ?? meta?.ts ?? "")}</span>
        {meta?.model ? <span className="assistant-model">{meta.model}</span> : null}
      </header>
      {focus !== "chat" ? (
        <ProcessBlock
          items={visibleProcess}
          meta={meta}
          collapseAll={collapseProcess}
          hiddenCount={allProcess.length - toggledProcess.length}
          firstMatch={firstMatch}
        />
      ) : null}
      {textItems.map((item) => (
        <Markdown key={item.i} className="assistant-text">
          {item.text ?? ""}
        </Markdown>
      ))}
    </article>
  );
}

function UserTurn({ item }: { item: TimelineItem }) {
  return (
    <article className="user-turn" data-prompt={item.i}>
      <div className="user-time">{formatRelativeTime(item.ts)}</div>
      <div className="user-bubble">
        <Markdown>{item.text ?? ""}</Markdown>
        {item.images ? <div className="image-note">[图片 ×{item.images}]</div> : null}
      </div>
    </article>
  );
}

function EventRow({ item }: { item: TimelineItem }) {
  return (
    <div className="event-row">
      <span className="event-pill">{item.label || "事件"}</span>
      {item.text ? <span className="event-text">{item.text}</span> : null}
    </div>
  );
}

function TurnRail({ prompts, onJump }: { prompts: PromptRef[]; onJump: (index: number) => void }) {
  if (prompts.length < 2) return null;
  return (
    <nav className="turn-rail" aria-label="轮次导航">
      {prompts.map((prompt, index) => (
        <button
          key={prompt.i}
          type="button"
          className="turn-dot"
          title={`${index + 1}. ${prompt.text}`}
          onClick={() => onJump(prompt.i)}
        >
          <span />
        </button>
      ))}
    </nav>
  );
}

function OutlinePanel({
  prompts,
  onJump,
  onClose,
}: {
  prompts: PromptRef[];
  onJump: (index: number) => void;
  onClose: () => void;
}) {
  return (
    <aside className="outline-panel">
      <div className="outline-head">
        <span>对话目录</span>
        <button type="button" className="icon-button" onClick={onClose} aria-label="关闭目录">
          <X size={15} />
        </button>
      </div>
      <div className="outline-list">
        {prompts.map((prompt, index) => (
          <button key={prompt.i} type="button" className="outline-item" onClick={() => onJump(prompt.i)}>
            <span className="outline-index">{index + 1}</span>
            <span className="outline-text">{prompt.text}</span>
          </button>
        ))}
        {prompts.length === 0 ? <div className="muted small">没有可导航的提问</div> : null}
      </div>
    </aside>
  );
}

export default function Reader({
  detail,
  loading,
  error,
  focus,
  setFocus,
  hideThinking,
  setHideThinking,
  hideTools,
  setHideTools,
  collapseProcess,
  setCollapseProcess,
  outlineOpen,
  setOutlineOpen,
  highlightQuery,
  onDelete,
  onToast,
  onMenu,
  onOpenSession,
}: ReaderProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const blocks = useMemo(() => (detail ? buildBlocks(detail.items) : []), [detail]);
  const firstMatch = useMemo(() => {
    if (!detail || !highlightQuery.trim()) return -1;
    return detail.items.find((item) => matchesQuery(item, highlightQuery))?.i ?? -1;
  }, [detail, highlightQuery]);

  useEffect(() => {
    const root = bodyRef.current;
    if (!root || !detail || !highlightQuery.trim()) return;
    const query = highlightQuery.trim().toLowerCase();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement && node.parentElement.closest(".turn-rail, .outline-panel")
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    const nodes: Text[] = [];
    let current = walker.nextNode();
    while (current) {
      nodes.push(current as Text);
      current = walker.nextNode();
    }
    const marks: HTMLElement[] = [];
    for (const node of nodes) {
      const value = node.nodeValue ?? "";
      const index = value.toLowerCase().indexOf(query);
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + query.length);
      const mark = document.createElement("mark");
      mark.className = "search-hit";
      range.surroundContents(mark);
      marks.push(mark);
      if (marks.length >= 80) break;
    }
    const visible = marks.find((mark) => mark.getClientRects().length > 0) ?? marks[0];
    const details = visible?.closest("details");
    if (details && !details.open) details.open = true;
    if (visible) {
      window.setTimeout(() => visible.scrollIntoView({ block: "center", behavior: "smooth" }), 100);
    }
    return () => {
      for (const mark of marks) {
        const parent = mark.parentNode;
        if (!parent) continue;
        parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
        parent.normalize();
      }
    };
  }, [detail, highlightQuery]);

  const jump = (index: number) => {
    const target = bodyRef.current?.querySelector(`[data-prompt="${index}"]`);
    target?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const copyResume = async () => {
    if (!detail?.resumeCommand) {
      onToast("该会话没有可用的恢复命令");
      return;
    }
    try {
      await navigator.clipboard.writeText(detail.resumeCommand);
      onToast("恢复命令已复制");
    } catch {
      onToast("复制失败，请手动选择");
    }
  };

  return (
    <div className="reader-pane">
      <div className="reader-toolbar">
        <button type="button" className="icon-button mobile-menu" onClick={onMenu} aria-label="会话列表">
          <Menu size={17} />
        </button>
        <div className="breadcrumb">
          {detail ? (
            <>
              <span className={`agent-dot ${detail.agent}`} />
              <span className="breadcrumb-agent">{agentLabel(detail.agent)}</span>
              <span className="breadcrumb-sep">/</span>
              <span className="breadcrumb-project">{detail.project}</span>
            </>
          ) : (
            <span className="muted">Agent 会话管理</span>
          )}
        </div>
        <div className="toolbar-group focus-switch" role="group" aria-label="内容筛选">
          {(["all", "chat", "changes"] as FocusMode[]).map((value) => (
            <button
              key={value}
              type="button"
              className={focus === value ? "on" : ""}
              onClick={() => setFocus(value)}
            >
              {value === "all" ? "全部" : value === "chat" ? "对话" : "改动"}
            </button>
          ))}
        </div>
        <div className="toolbar-group">
          <button
            type="button"
            className={`toolbar-button ${collapseProcess ? "on" : ""}`}
            onClick={() => setCollapseProcess(!collapseProcess)}
            title={collapseProcess ? "展开全部执行过程" : "收起全部执行过程"}
            aria-pressed={collapseProcess}
          >
            {collapseProcess ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            <span className="hide-sm">{collapseProcess ? "展开过程" : "收起过程"}</span>
          </button>
          <button
            type="button"
            className={`toolbar-button ${hideThinking ? "on" : ""}`}
            onClick={() => setHideThinking(!hideThinking)}
            title="隐藏 / 显示思考"
          >
            <Brain size={14} />
            <span className="hide-sm">{hideThinking ? "显示思考" : "隐藏思考"}</span>
          </button>
          <button
            type="button"
            className={`toolbar-button ${hideTools ? "on" : ""}`}
            onClick={() => setHideTools(!hideTools)}
            title="隐藏 / 显示工具"
          >
            <Wrench size={14} />
            <span className="hide-sm">{hideTools ? "显示工具" : "隐藏工具"}</span>
          </button>
        </div>
        <div className="toolbar-group toolbar-right">
          <button
            type="button"
            className={`toolbar-button ${outlineOpen ? "on" : ""}`}
            onClick={() => setOutlineOpen(!outlineOpen)}
            title="对话目录"
          >
            <ListTree size={14} />
            <span className="hide-sm">目录</span>
          </button>
          {detail ? (
            <>
              <a
                className="toolbar-button"
                href={`/api/sessions/${encodeURIComponent(detail.key)}/export?thinking=${hideThinking ? 0 : 1}&tools=${hideTools ? 0 : 1}`}
                title="导出当前视图为 Markdown"
              >
                <Download size={14} />
                <span className="hide-sm">导出 .md</span>
              </a>
              <button type="button" className="toolbar-button" onClick={copyResume} title={detail.resumeCommand ?? "无恢复命令"}>
                <Terminal size={14} />
                <span className="hide-sm">恢复命令</span>
              </button>
              <button type="button" className="toolbar-button danger" onClick={onDelete} title="永久删除该会话">
                <Trash2 size={14} />
                <span className="hide-sm">清理</span>
              </button>
            </>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="reader-loading">
          <div className="skeleton title" />
          <div className="skeleton line" />
          <div className="skeleton line short" />
          <div className="skeleton block" />
          <div className="skeleton block" />
        </div>
      ) : error ? (
        <div className="reader-error">
          <h2>读取失败</h2>
          <p>{error}</p>
        </div>
      ) : detail ? (
        <div className="reader-scroll">
          <div className="reader-document">
            <TurnRail prompts={detail.prompts} onJump={jump} />
            <div className="doc-main" ref={bodyRef}>
              <header className="session-head">
                <div className="session-title-row">
                  <AgentAvatar agent={detail.agent} size={26} />
                  <h1>{detail.title || "未命名会话"}</h1>
                </div>
                <SessionMetaBar detail={detail} onToast={onToast} onOpenSession={onOpenSession} />
                <div className="session-stats">
                  <span>{detail.stats.turns} 轮提问</span>
                  <span>{detail.stats.messages} 条消息</span>
                  <span>{detail.stats.toolCalls} 次工具调用</span>
                  <span>{formatTokens(detail.stats.thinkingChars)} 字思考</span>
                  {detail.truncated ? <span className="warn">内容已截断</span> : null}
                </div>
              </header>
              <div className="timeline">
                {blocks.map((block) => {
                  if (block.kind === "user") return <UserTurn key={`u${block.item.i}`} item={block.item} />;
                  if (block.kind === "event") return <EventRow key={`e${block.item.i}`} item={block.item} />;
                  return (
                    <AssistantGroup
                      key={block.id}
                      block={block}
                      meta={detail.groups[block.id]}
                      detail={detail}
                      focus={focus}
                      hideThinking={hideThinking}
                      hideTools={hideTools}
                      collapseProcess={collapseProcess}
                      firstMatch={firstMatch}
                    />
                  );
                })}
                {blocks.length === 0 ? <div className="muted">该会话没有可显示的消息。</div> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {outlineOpen && detail ? (
        <OutlinePanel prompts={detail.prompts} onJump={jump} onClose={() => setOutlineOpen(false)} />
      ) : null}
    </div>
  );
}

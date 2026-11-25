"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FilePenLine,
  FileText,
  Globe,
  ListTodo,
  Search,
  Terminal,
  Wrench,
} from "lucide-react";
import DiffView from "./DiffView";
import type { TimelineItem } from "@/lib/types";
import { isObject } from "@/lib/guards";

function ToolIcon({ name }: { name: string }) {
  const lowered = name.toLowerCase();
  if (lowered === "bash" || lowered === "shell" || lowered === "eval") return <Terminal size={14} />;
  if (lowered === "read") return <FileText size={14} />;
  if (lowered === "edit" || lowered === "write" || lowered === "apply_patch") return <FilePenLine size={14} />;
  if (lowered === "grep" || lowered === "glob" || lowered === "rg") return <Search size={14} />;
  if (lowered.includes("web")) return <Globe size={14} />;
  if (lowered === "todo") return <ListTodo size={14} />;
  return <Wrench size={14} />;
}

function Arguments({ args }: { args: unknown }) {
  const [copied, setCopied] = useState(false);
  const pretty = useMemo(() => {
    if (!isObject(args)) return String(args ?? "");
    const command = args.command ?? args.cmd ?? args.script;
    if (typeof command === "string") return command;
    try {
      return JSON.stringify(args, null, 2);
    } catch {
      return String(args);
    }
  }, [args]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pretty);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard is best effort.
    }
  };
  if (!pretty) return <div className="muted small">无参数</div>;
  return (
    <div className="arg-block">
      <button type="button" className="mini-copy" onClick={copy}>
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? "已复制" : "复制"}
      </button>
      <pre className="tool-args">{pretty}</pre>
    </div>
  );
}

export default function ToolCard({ item, forceOpen = false }: { item: TimelineItem; forceOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(item.result?.isError) || forceOpen);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  const [copied, setCopied] = useState(false);
  const hasResult = Boolean(item.result);
  const hasDiff = Boolean(item.diff);
  const metrics: string[] = [];
  if (item.diff) metrics.push(`+${item.diff.additions} -${item.diff.deletions}`);
  if (item.result) metrics.push(`${item.result.chars.toLocaleString()} 字`);
  if (item.result?.isError) metrics.push("失败");

  const copyResult = async () => {
    if (!item.result) return;
    try {
      await navigator.clipboard.writeText(item.result.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard is best effort.
    }
  };

  return (
    <div className={`tool-card ${item.result?.isError ? "is-error" : ""} ${open ? "open" : ""}`}>
      <button type="button" className="tool-head" onClick={() => setOpen((value) => !value)}>
        <span className={`tool-dot ${item.result?.isError ? "error" : "ok"}`} />
        <span className="tool-icon">
          <ToolIcon name={item.name ?? ""} />
        </span>
        <span className="tool-name">{item.label ?? item.name}</span>
        <span className="tool-target" title={item.target}>
          {item.target || "—"}
        </span>
        <span className="tool-metrics">{metrics.join(" · ")}</span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open ? (
        <div className="tool-body">
          {hasDiff && item.diff ? (
            <div className="tool-section">
              <div className="section-label">改动</div>
              <DiffView diff={item.diff} />
            </div>
          ) : null}
          <div className="tool-section">
            <div className="section-label">参数</div>
            <Arguments args={item.args} />
          </div>
          {hasResult && item.result ? (
            <div className="tool-section">
              <div className="section-label-row">
                <span className="section-label">结果</span>
                <span className="muted small">
                  {item.result.chars.toLocaleString()} 字
                  {item.result.truncated ? " · 已截断" : ""}
                  {item.result.images ? ` · ${item.result.images} 张图片` : ""}
                </span>
                <button type="button" className="mini-copy" onClick={copyResult}>
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? "已复制" : "复制"}
                </button>
              </div>
              <pre className={`tool-output ${item.result.isError ? "error" : ""}`}>
                {item.result.text || "(空输出)"}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

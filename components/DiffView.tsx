"use client";

import { useMemo, useState } from "react";
import type { ToolDiff } from "@/lib/types";

export default function DiffView({ diff }: { diff: ToolDiff }) {
  const [mode, setMode] = useState<"unified" | "raw">(diff.mode === "patch" ? "raw" : "unified");
  const raw = useMemo(() => {
    if (diff.patch) return diff.patch;
    return diff.lines
      .map((line) => {
        const prefix = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
        return prefix + line.text;
      })
      .join("\n");
  }, [diff]);

  return (
    <div className="diff">
      <div className="diff-head">
        <div className="diff-path" title={diff.path}>
          {diff.path || "patch"}
        </div>
        <div className="diff-stats">
          <span className="add">+{diff.additions}</span>
          <span className="del">-{diff.deletions}</span>
          {diff.truncated ? <span className="muted">已截断</span> : null}
        </div>
        {diff.mode !== "patch" ? (
          <div className="diff-switch">
            <button type="button" className={mode === "unified" ? "on" : ""} onClick={() => setMode("unified")}>
              统一 Diff
            </button>
            <button type="button" className={mode === "raw" ? "on" : ""} onClick={() => setMode("raw")}>
              原始补丁
            </button>
          </div>
        ) : null}
      </div>
      {mode === "raw" ? (
        <pre className="diff-raw">{raw || "(空)"}</pre>
      ) : (
        <div className="diff-body">
          {diff.lines.map((line, index) => (
            <div key={`${index}-${line.type}`} className={`diff-line ${line.type}`}>
              <span className="diff-ln">{line.type === "add" ? "" : line.old ?? ""}</span>
              <span className="diff-ln">{line.type === "del" ? "" : line.new ?? ""}</span>
              <span className="diff-mark">
                {line.type === "add" ? "+" : line.type === "del" ? "-" : ""}
              </span>
              <span className="diff-text">{line.text || " "}</span>
            </div>
          ))}
          {diff.lines.length === 0 ? <div className="diff-empty">没有行级差异</div> : null}
        </div>
      )}
    </div>
  );
}

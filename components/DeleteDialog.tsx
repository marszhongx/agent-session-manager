"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";
import type { DeleteResult, SessionMeta } from "@/lib/types";
import { formatBytes } from "@/lib/format";

interface DeleteDialogProps {
  targets: SessionMeta[];
  onClose: () => void;
  onConfirm: (keys: string[], cascade: boolean) => Promise<DeleteResult>;
}

export default function DeleteDialog({ targets, onClose, onConfirm }: DeleteDialogProps) {
  const [cascade, setCascade] = useState(() =>
    targets.some((target) => target.hasSidecar || target.childCount > 0),
  );
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const totalSize = useMemo(() => targets.reduce((sum, target) => sum + target.size, 0), [targets]);
  const childCount = useMemo(() => targets.reduce((sum, target) => sum + target.childCount, 0), [targets]);
  const hasSidecar = targets.some((target) => target.hasSidecar);
  const active = targets.some((target) => target.active);
  const canDelete = confirm === "DELETE" && !busy;

  const submit = async () => {
    if (!canDelete) return;
    setBusy(true);
    setErrors([]);
    try {
      const result = await onConfirm(targets.map((target) => target.key), cascade);
      if (result.errors.length > 0) {
        setErrors(result.errors.map((error) => error.message));
        setBusy(false);
        return;
      }
      onClose();
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "清理失败"]);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-title">
        <div className="modal-head">
          <div className="modal-title">
            <span className="danger-icon">
              <Trash2 size={16} />
            </span>
            <h2 id="delete-title">永久清理会话</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <div className="danger-banner">
            <AlertTriangle size={16} />
            <div>
              <strong>此操作直接删除原始 Agent 会话文件，不可恢复。</strong>
              <p>应用不保存任何备份或索引；需要保留请先点击「导出 .md」。</p>
            </div>
          </div>

          <div className="delete-summary">
            <span>{targets.length} 个会话</span>
            <span>{formatBytes(totalSize)}</span>
            {childCount > 0 ? <span>{childCount} 个子会话</span> : null}
          </div>

          <ul className="delete-list">
            {targets.slice(0, 6).map((target) => (
              <li key={target.key}>
                <span className={`agent-dot ${target.agent}`} />
                <span className="delete-title">{target.title}</span>
                <span className="muted">{target.project}</span>
              </li>
            ))}
            {targets.length > 6 ? <li className="muted">还有 {targets.length - 6} 个会话…</li> : null}
          </ul>

          {active ? (
            <div className="active-warning">
              选中包含最近 30 秒内写入的会话。服务端会拒绝清理，请先退出对应 Agent 后重试。
            </div>
          ) : null}

          {hasSidecar || childCount > 0 ? (
            <label className="check-line">
              <input type="checkbox" checked={cascade} onChange={(event) => setCascade(event.target.checked)} />
              <span>
                同时删除侧车目录（changes.jsonl 等工具记录
                {childCount > 0 ? `，包含 ${childCount} 个子会话` : ""}）
              </span>
            </label>
          ) : null}

          <label className="confirm-line">
            <span>
              输入 <code>DELETE</code> 确认
            </span>
            <input
              autoFocus
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder="DELETE"
              spellCheck={false}
              disabled={busy}
            />
          </label>

          {errors.length > 0 ? (
            <div className="modal-errors">
              {errors.map((error, index) => (
                <p key={index}>{error}</p>
              ))}
            </div>
          ) : null}
        </div>
        <div className="modal-foot">
          <button type="button" className="ghost-button" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="button" className="danger-button" onClick={submit} disabled={!canDelete}>
            {busy ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
            永久删除
          </button>
        </div>
      </div>
    </div>
  );
}

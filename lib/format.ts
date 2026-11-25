export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 100 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

export function formatCost(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 0.01) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4)}`;
}

export function formatDuration(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return `${minutes}m${seconds ? `${seconds}s` : ""}`;
}

export function formatRelativeTime(iso: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const diff = Date.now() - date.getTime();
  if (diff < 0) return formatClock(iso);
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 172_800_000) return "昨天";
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return formatDate(iso);
}

export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const now = new Date();
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export function formatDateTime(iso: string): string {
  if (!iso) return "—";
  return `${formatDate(iso)} ${formatClock(iso)}`;
}

export function shortId(value: string, length = 10): string {
  if (!value) return "—";
  return value.length <= length ? value : value.slice(0, length);
}

export function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    title: "标题",
    user: "提问",
    assistant: "回复",
    thinking: "思考",
    tool: "工具",
    result: "输出",
    event: "事件",
  };
  return labels[role] ?? role;
}

export function agentLabel(agent: string): string {
  return agent === "pi" ? "pi" : agent === "omp" ? "omp" : agent;
}

export function timeBucket(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "更早";
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const stamp = date.getTime();
  if (stamp >= start) return "今天";
  if (stamp >= start - 86_400_000) return "昨天";
  if (stamp >= start - 7 * 86_400_000) return "近 7 天";
  return "更早";
}

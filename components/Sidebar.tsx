"use client";

import { useEffect, useMemo, useState, type RefObject } from "react";
import {
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Folder,
  Moon,
  RefreshCw,
  Search,
  Square,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import type {
  Agent,
  RootInfo,
  SearchResponse,
  SessionCounts,
  SessionMeta,
  SessionStatus,
} from "@/lib/types";
import {
  agentLabel,
  formatBytes,
  formatRelativeTime,
  roleLabel,
  timeBucket,
} from "@/lib/format";

interface SidebarProps {
  sessions: SessionMeta[];
  counts: SessionCounts;
  roots: RootInfo[];
  loading: boolean;
  listError: string | null;
  elapsedMs: number;
  scannedFiles: number;
  agent: string;
  onAgent: (value: string) => void;
  status: SessionStatus;
  onStatus: (value: SessionStatus) => void;
  viewMode: "project" | "time";
  onViewMode: (value: "project" | "time") => void;
  query: string;
  onQuery: (value: string) => void;
  bodySearch: boolean;
  onBodySearch: (value: boolean) => void;
  search: SearchResponse | null;
  searching: boolean;
  searchError: string | null;
  selectedKey: string | null;
  onSelect: (key: string, highlight?: string) => void;
  onRefresh: () => void;
  theme: "dark" | "light";
  onTheme: () => void;
  batchMode: boolean;
  onBatchMode: (value: boolean) => void;
  selected: Set<string>;
  onToggleSelected: (key: string) => void;
  onSelectMany: (keys: string[]) => void;
  onClearSelected: () => void;
  onRequestDelete: () => void;
  searchRef: RefObject<HTMLInputElement | null>;
}

function AgentDot({ agent }: { agent: Agent }) {
  return <span className={`agent-dot ${agent}`} title={agentLabel(agent)} />;
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const terms = useMemo(
    () => query.trim().split(/\s+/).filter(Boolean).map((term) => term.toLowerCase()),
    [query],
  );
  if (terms.length === 0 || !text) return <>{text}</>;
  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  const set = new Set(terms);
  return (
    <>
      {text.split(regex).map((part, index) =>
        set.has(part.toLowerCase()) ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>,
      )}
    </>
  );
}

function SessionRow({
  session,
  checked,
  current,
  batchMode,
  onSelect,
  onToggle,
  showAgent,
}: {
  session: SessionMeta;
  checked: boolean;
  current: boolean;
  batchMode: boolean;
  onSelect: () => void;
  onToggle: () => void;
  showAgent: boolean;
  child?: boolean;
}) {
  const activate = () => {
    if (batchMode) onToggle();
    else onSelect();
  };
  return (
    <div
      role="button"
      tabIndex={0}
      className={`session-row ${checked ? "checked" : ""} ${current ? "current" : ""} ${batchMode ? "batch" : ""} ${session.isChild ? "child" : ""}`}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      }}
      title={`${session.title}\n${session.cwd}`}
    >
      {batchMode ? (
        <span className={`check ${checked ? "on" : ""}`} aria-hidden>
          {checked ? <CheckSquare size={14} /> : <Square size={14} />}
        </span>
      ) : null}
      <span className="row-state">
        {session.active ? <span className="live-dot" /> : <span className="row-gap" />}
      </span>
      <div className="row-main">
        <div className="row-title">
          {showAgent ? <AgentDot agent={session.agent} /> : null}
          {session.title}
        </div>
        <div className="row-meta">
          <span>{formatRelativeTime(session.updatedAt)}</span>
          {session.isChild ? <span className="mini-badge">子会话</span> : null}
          {session.isChild && session.parentTitle ? (
            <span className="row-parent" title={`归属：${session.parentTitle}`}>
              ↳ {session.parentTitle}
            </span>
          ) : session.model ? (
            <span className="row-model">{session.model}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ProjectGroups({
  sessions,
  selectedKey,
  batchMode,
  selected,
  onSelect,
  onToggle,
  collapseSignal,
  collapseAll,
  onGroupToggle,
}: {
  sessions: SessionMeta[];
  selectedKey: string | null;
  batchMode: boolean;
  selected: Set<string>;
  onSelect: (key: string) => void;
  onToggle: (key: string) => void;
  collapseSignal: number;
  collapseAll: boolean;
  onGroupToggle: () => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const agents = useMemo(() => {
    const map = new Map<Agent, Map<string, { label: string; cwd: string; sessions: SessionMeta[] }>>();
    for (const session of sessions) {
      let projects = map.get(session.agent);
      if (!projects) {
        projects = new Map();
        map.set(session.agent, projects);
      }
      const key = session.cwd || session.relpath.split("/")[0];
      let project = projects.get(key);
      if (!project) {
        project = { label: session.project, cwd: session.cwd, sessions: [] };
        projects.set(key, project);
      }
      project.sessions.push(session);
    }
    for (const projects of map.values()) {
      for (const project of projects.values()) {
        project.sessions.sort((a, b) => Number(a.isChild) - Number(b.isChild) || b.mtime - a.mtime);
      }
    }
    return Array.from(map.entries());
  }, [sessions]);

  const allKeys = useMemo(() => {
    const keys: string[] = [];
    for (const [agent, projects] of agents) {
      keys.push(`agent:${agent}`);
      for (const [key] of projects) keys.push(`project:${agent}:${key}`);
    }
    return keys;
  }, [agents]);

  useEffect(() => {
    if (collapseSignal === 0) return;
    setCollapsed(collapseAll ? new Set(allKeys) : new Set());
  }, [collapseSignal, collapseAll, allKeys]);

  const toggle = (key: string) => {
    onGroupToggle();
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (agents.length === 0) return <EmptyList />;

  return (
    <div className="groups">
      {agents.map(([agent, projects]) => {
        const total = Array.from(projects.values()).reduce((sum, project) => sum + project.sessions.length, 0);
        const agentKey = `agent:${agent}`;
        const agentCollapsed = collapsed.has(agentKey);
        return (
          <section key={agent} className="agent-section">
            <button type="button" className="agent-head" onClick={() => toggle(agentKey)} aria-expanded={!agentCollapsed}>
              {agentCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              <AgentDot agent={agent} />
              <span className="agent-name">{agentLabel(agent)}</span>
              <span className="group-count">{total}</span>
            </button>
            {!agentCollapsed
              ? Array.from(projects.entries()).map(([key, project]) => {
                  const projectKey = `project:${agent}:${key}`;
                  const projectCollapsed = collapsed.has(projectKey);
                  return (
                    <div key={key} className="project-section">
                      <button
                        type="button"
                        className="project-head"
                        title={project.cwd}
                        onClick={() => toggle(projectKey)}
                        aria-expanded={!projectCollapsed}
                      >
                        {projectCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                        <Folder size={13} />
                        <span>{project.label}</span>
                        <span className="group-count">{project.sessions.length}</span>
                      </button>
                      {!projectCollapsed
                        ? project.sessions.map((session) => (
                            <SessionRow
                              key={session.key}
                              session={session}
                              checked={selected.has(session.key)}
                              current={selectedKey === session.key}
                              batchMode={batchMode}
                              onSelect={() => onSelect(session.key)}
                              onToggle={() => onToggle(session.key)}
                              showAgent={false}
                            />
                          ))
                        : null}
                    </div>
                  );
                })
              : null}
          </section>
        );
      })}
    </div>
  );
}

function TimeGroups({
  sessions,
  selectedKey,
  batchMode,
  selected,
  onSelect,
  onToggle,
  collapseSignal,
  collapseAll,
  onGroupToggle,
}: {
  sessions: SessionMeta[];
  selectedKey: string | null;
  batchMode: boolean;
  selected: Set<string>;
  onSelect: (key: string) => void;
  onToggle: (key: string) => void;
  collapseSignal: number;
  collapseAll: boolean;
  onGroupToggle: () => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const buckets = useMemo(() => {
    const order = ["今天", "昨天", "近 7 天", "更早"];
    const map = new Map<string, SessionMeta[]>();
    for (const session of sessions) {
      const bucket = timeBucket(session.updatedAt);
      const list = map.get(bucket) ?? [];
      list.push(session);
      map.set(bucket, list);
    }
    return order.filter((bucket) => map.has(bucket)).map((bucket) => [bucket, map.get(bucket)!] as const);
  }, [sessions]);

  useEffect(() => {
    if (collapseSignal === 0) return;
    setCollapsed(collapseAll ? new Set(buckets.map(([bucket]) => `time:${bucket}`)) : new Set());
  }, [collapseSignal, collapseAll, buckets]);

  if (buckets.length === 0) return <EmptyList />;
  return (
    <div className="groups">
      {buckets.map(([bucket, list]) => {
        const key = `time:${bucket}`;
        const isCollapsed = collapsed.has(key);
        return (
          <section key={bucket} className="time-section">
            <button type="button" className="time-head" onClick={() => {
              onGroupToggle();
              setCollapsed((current) => {
              const next = new Set(current);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              });
            }} aria-expanded={!isCollapsed}>
              {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              <span>{bucket}</span>
              <span className="group-count">{list.length}</span>
            </button>
            {!isCollapsed
              ? list.map((session) => (
                  <SessionRow
                    key={session.key}
                    session={session}
                    checked={selected.has(session.key)}
                    current={selectedKey === session.key}
                    batchMode={batchMode}
                    onSelect={() => onSelect(session.key)}
                    onToggle={() => onToggle(session.key)}
                    showAgent
                  />
                ))
              : null}
          </section>
        );
      })}
    </div>
  );
}

function EmptyList() {
  return (
    <div className="list-empty">
      <Search size={20} />
      <p>没有匹配的会话</p>
      <span>试试切换 Agent、状态或清空搜索</span>
    </div>
  );
}

function SearchResults({
  search,
  searching,
  error,
  query,
  onSelect,
}: {
  search: SearchResponse | null;
  searching: boolean;
  error: string | null;
  query: string;
  onSelect: (key: string, highlight: string) => void;
}) {
  if (searching) {
    return (
      <div className="search-state">
        <div className="spinner" />
        <p>正在实时扫描 JSONL 文件…</p>
        <span>不读取索引，直接检索正文，保证结果与磁盘一致</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="search-state error">
        <p>检索失败</p>
        <span>{error}</span>
      </div>
    );
  }
  if (!search) {
    return (
      <div className="search-state">
        <p>输入至少 2 个字符开始正文检索</p>
        <span>每次检索都会重新读取原始会话文件</span>
      </div>
    );
  }
  return (
    <div className="search-results">
      <div className="search-summary">
        <strong>{search.results.length}</strong> 条结果
        <span>
          {search.scannedFiles} 个文件 · {formatBytes(search.scannedBytes)} · {search.elapsedMs} ms
        </span>
        {search.truncated ? <em>仅显示前 {search.results.length} 条</em> : null}
      </div>
      {search.results.map((result) => (
        <button
          type="button"
          key={result.sessionKey}
          className="search-result"
          onClick={() => onSelect(result.sessionKey, query)}
        >
          <div className="search-result-head">
            <AgentDot agent={result.agent} />
            <span className="search-result-title">{result.title}</span>
            <span className="role-chip">{roleLabel(result.role)}</span>
          </div>
          <div className="search-result-meta">
            {result.project} · {formatRelativeTime(result.ts)}
            {result.hitCount > 1 ? ` · ${result.hitCount} 处命中` : ""}
          </div>
          <p className="search-snippet">
            <HighlightedText text={result.snippet} query={query} />
          </p>
        </button>
      ))}
      {search.results.length === 0 ? (
        <div className="list-empty">
          <Search size={20} />
          <p>没有找到正文匹配</p>
          <span>已扫描全部 {search.scannedFiles} 个会话文件</span>
        </div>
      ) : null}
    </div>
  );
}

export default function Sidebar({
  sessions,
  counts,
  roots,
  loading,
  listError,
  elapsedMs,
  scannedFiles,
  agent,
  onAgent,
  status,
  onStatus,
  viewMode,
  onViewMode,
  query,
  onQuery,
  bodySearch,
  onBodySearch,
  search,
  searching,
  searchError,
  selectedKey,
  onSelect,
  onRefresh,
  theme,
  onTheme,
  batchMode,
  onBatchMode,
  selected,
  onToggleSelected,
  onSelectMany,
  onClearSelected,
  onRequestDelete,
  searchRef,
}: SidebarProps) {
  const visibleKeys = useMemo(() => sessions.map((session) => session.key), [sessions]);
  const allSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selected.has(key));
  const searchActive = bodySearch && query.trim().length >= 2;
  const [collapseAll, setCollapseAll] = useState(false);
  const [collapseSignal, setCollapseSignal] = useState(0);
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="logo" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <div className="brand-text">
          <h1>Agent 会话管理</h1>
          <p>pi + omp · 无索引实时读取</p>
        </div>
        <button type="button" className="icon-button" onClick={onTheme} title="切换亮 / 暗主题">
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>

      <div className="side-controls">
        <label className="select-wrap">
          <span className="sr-only">Agent</span>
          <select value={agent} onChange={(event) => onAgent(event.target.value)}>
            <option value="all">全部 Agent</option>
            <option value="pi">pi</option>
            <option value="omp">omp</option>
          </select>
        </label>
        <div className="view-switch" role="group" aria-label="分组方式">
          <button
            type="button"
            className={viewMode === "project" ? "on" : ""}
            onClick={() => onViewMode("project")}
          >
            项目
          </button>
          <button
            type="button"
            className={viewMode === "time" ? "on" : ""}
            onClick={() => onViewMode("time")}
          >
            时间
          </button>
        </div>
        <button type="button" className="icon-button" onClick={onRefresh} title="重新扫描目录">
          <RefreshCw size={15} className={loading ? "spin" : ""} />
        </button>
      </div>

      <div className={`searchbar ${bodySearch ? "body-on" : ""}`}>
        <Search size={15} className="search-icon" />
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={bodySearch ? "搜索全部正文…" : "搜索标题、项目或路径…"}
          spellCheck={false}
        />
        {query ? (
          <button type="button" className="search-clear" onClick={() => onQuery("")} aria-label="清空搜索">
            <X size={13} />
          </button>
        ) : (
          <kbd>Ctrl K</kbd>
        )}
        <button
          type="button"
          className={`body-toggle ${bodySearch ? "on" : ""}`}
          onClick={() => onBodySearch(!bodySearch)}
          title="开启后直接全文扫描原始 JSONL（无索引）"
        >
          正文
        </button>
      </div>

      <div className="chips">
        {(
          [
            ["all", "全部"],
            ["recent", "最近"],
            ["children", "子会话"],
          ] as [SessionStatus, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`chip ${status === value ? "on" : ""}`}
            onClick={() => onStatus(value)}
          >
            {label}
            <span>{counts[value]}</span>
          </button>
        ))}
        {counts.active > 0 ? (
          <span className="chip passive">
            <span className="live-dot" />
            {counts.active} 活跃
          </span>
        ) : null}
        <button
          type="button"
          className={`chip select-toggle ${batchMode ? "on" : ""}`}
          onClick={() => {
            onBatchMode(!batchMode);
            if (batchMode) onClearSelected();
          }}
        >
          {batchMode ? "完成" : "选择"}
        </button>
      </div>

      <div className="side-meta">
        <span>
          {scannedFiles} 文件 · {formatBytes(counts.totalSize)}
        </span>
        <span>{elapsedMs} ms</span>
        <span className="no-index">无索引</span>
        <button
          type="button"
          className="side-collapse"
          onClick={() => {
            setCollapseAll((value) => !value);
            setCollapseSignal((value) => value + 1);
          }}
        >
          {collapseAll ? "展开全部" : "折叠全部"}
        </button>
      </div>

      <div className="side-scroll">
        {searchActive ? (
          <SearchResults
            search={search}
            searching={searching}
            error={searchError}
            query={query}
            onSelect={onSelect}
          />
        ) : loading ? (
          <div className="list-skeleton">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="row-skeleton" />
            ))}
          </div>
        ) : listError ? (
          <div className="search-state error">
            <p>读取失败</p>
            <span>{listError}</span>
          </div>
        ) : viewMode === "project" ? (
          <ProjectGroups
            sessions={sessions}
            selectedKey={selectedKey}
            batchMode={batchMode}
            selected={selected}
            onSelect={onSelect}
            onToggle={onToggleSelected}
            collapseSignal={collapseSignal}
            collapseAll={collapseAll}
            onGroupToggle={() => setCollapseAll(false)}
          />
        ) : (
          <TimeGroups
            sessions={sessions}
            selectedKey={selectedKey}
            batchMode={batchMode}
            selected={selected}
            onSelect={onSelect}
            onToggle={onToggleSelected}
            collapseSignal={collapseSignal}
            collapseAll={collapseAll}
            onGroupToggle={() => setCollapseAll(false)}
          />
        )}
      </div>

      {batchMode ? (
        <div className="batch-bar">
          <span>
            已选 <strong>{selected.size}</strong> 个
          </span>
          <button type="button" className="link-button" onClick={() => (allSelected ? onClearSelected() : onSelectMany(visibleKeys))}>
            {allSelected ? "取消全选" : "全选"}
          </button>
          <button
            type="button"
            className="danger-button small"
            disabled={selected.size === 0}
            onClick={onRequestDelete}
          >
            <Trash2 size={13} />
            清理
          </button>
        </div>
      ) : null}

      <div className="root-foot">
        {roots.map((root) => (
          <div key={root.agent} className={`root-line ${root.exists ? "" : "missing"}`} title={root.path}>
            <AgentDot agent={root.agent} />
            <span>{agentLabel(root.agent)}</span>
            <span className="root-count">{root.sessionCount}</span>
            <span className="root-path">{root.exists ? root.path : "目录不存在"}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

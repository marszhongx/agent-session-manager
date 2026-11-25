"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Loader2, Menu, RefreshCw, Sparkles } from "lucide-react";
import Sidebar from "./Sidebar";
import Reader from "./Reader";
import DeleteDialog from "./DeleteDialog";
import {
  deleteSessions,
  getSession,
  getSessions,
  searchSessions,
} from "@/lib/client";
import { agentLabel, formatBytes } from "@/lib/format";
import type {
  DeleteResult,
  FocusMode,
  RootInfo,
  SearchResponse,
  SessionCounts,
  SessionDetail,
  SessionListResponse,
  SessionMeta,
  SessionStatus,
} from "@/lib/types";

function computeCounts(sessions: SessionMeta[]): SessionCounts {
  const now = Date.now();
  return {
    all: sessions.length,
    recent: sessions.filter((session) => now - session.mtime * 1000 < 7 * 24 * 3600 * 1000).length,
    children: sessions.filter((session) => session.isChild).length,
    active: sessions.filter((session) => session.active).length,
    agents: sessions.reduce<Record<string, number>>((acc, session) => {
      acc[session.agent] = (acc[session.agent] ?? 0) + 1;
      return acc;
    }, {}),
    totalSize: sessions.reduce((sum, session) => sum + session.size, 0),
  };
}

function Welcome({
  list,
  loading,
  error,
  onRefresh,
  onFirst,
  onMenu,
}: {
  list: SessionListResponse | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onFirst: () => void;
  onMenu: () => void;
}) {
  const first = list?.sessions[0];
  return (
    <div className="reader-pane welcome-pane">
      <div className="reader-toolbar">
        <button type="button" className="icon-button mobile-menu" onClick={onMenu} aria-label="会话列表">
          <Menu size={17} />
        </button>
        <div className="breadcrumb">
          <span className="muted">Agent 会话管理</span>
        </div>
      </div>
      <div className="welcome">
        <div className="welcome-logo" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <p className="eyebrow">
          <Sparkles size={13} /> pi + omp · 分层读取 · 零存储
        </p>
        <h1>把本地 Agent 会话，<br />当成一份可检索的工程档案。</h1>
        <p className="welcome-copy">
          列表只读会话头部，打开后才解析完整时间线；正文检索直接扫描原始 JSONL。
          没有索引文件，也不复制会话内容。
        </p>
        {error ? (
          <div className="welcome-error">
            <p>{error}</p>
            <button type="button" className="ghost-button" onClick={onRefresh}>
              <RefreshCw size={14} /> 重试
            </button>
          </div>
        ) : loading ? (
          <div className="welcome-loading">
            <Loader2 size={16} className="spin" /> 正在读取会话目录…
          </div>
        ) : (
          <>
            <div className="welcome-stats">
              <div>
                <strong>{list?.counts.all ?? 0}</strong>
                <span>会话</span>
              </div>
              <div>
                <strong>{formatBytes(list?.counts.totalSize ?? 0)}</strong>
                <span>原始数据</span>
              </div>
              <div>
                <strong>{list?.counts.agents.pi ?? 0}</strong>
                <span>pi</span>
              </div>
              <div>
                <strong>{list?.counts.agents.omp ?? 0}</strong>
                <span>omp</span>
              </div>
            </div>
            <div className="welcome-actions">
              {first ? (
                <button type="button" className="primary-button" onClick={onFirst}>
                  打开最近会话
                  <ArrowRight size={15} />
                </button>
              ) : null}
              <button type="button" className="ghost-button" onClick={onRefresh}>
                <RefreshCw size={14} /> 重新扫描
              </button>
            </div>
            <div className="root-cards">
              {(list?.roots ?? []).map((root: RootInfo) => (
                <div key={root.agent} className={`root-card ${root.exists ? "" : "missing"}`}>
                  <span className={`agent-dot ${root.agent}`} />
                  <div>
                    <strong>{agentLabel(root.agent)}</strong>
                    <p title={root.path}>{root.path}</p>
                  </div>
                  <span>{root.exists ? `${root.sessionCount} 会话` : "目录不存在"}</span>
                </div>
              ))}
            </div>
            <p className="welcome-note">
              可通过 <code>ASM_PI_ROOT</code> / <code>ASM_OMP_ROOT</code> 指定会话目录。
              列表扫描耗时 {list?.elapsedMs ?? 0} ms，共读取 {list?.scannedFiles ?? 0} 个文件。
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function AppShell() {
  const [list, setList] = useState<SessionListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [agent, setAgent] = useState("all");
  const [status, setStatus] = useState<SessionStatus>("all");
  const [viewMode, setViewMode] = useState<"project" | "time">("project");
  const [query, setQuery] = useState("");
  const [bodySearch, setBodySearch] = useState(false);
  const [search, setSearch] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [highlightQuery, setHighlightQuery] = useState("");
  const [focus, setFocus] = useState<FocusMode>("all");
  const [hideThinking, setHideThinking] = useState(false);
  const [hideTools, setHideTools] = useState(false);
  const [collapseProcess, setCollapseProcess] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);

  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteTargets, setDeleteTargets] = useState<SessionMeta[] | null>(null);
  const [toast, setToast] = useState("");

  const searchRef = useRef<HTMLInputElement>(null);
  const updateQuery = useCallback(
    (value: string) => {
      setQuery(value);
      if (value.trim() !== highlightQuery.trim()) setHighlightQuery("");
    },
    [highlightQuery],
  );
  const listAbort = useRef<AbortController | null>(null);
  const detailAbort = useRef<AbortController | null>(null);

  const showToast = useCallback((message: string) => setToast(message), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const refreshList = useCallback(async () => {
    listAbort.current?.abort();
    const controller = new AbortController();
    listAbort.current = controller;
    setLoading(true);
    setListError(null);
    try {
      const data = await getSessions(controller.signal);
      if (!controller.signal.aborted) setList(data);
    } catch (error) {
      if (!controller.signal.aborted) {
        setListError(error instanceof Error ? error.message : "读取会话目录失败");
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  const openSession = useCallback(async (key: string, highlight = "") => {
    detailAbort.current?.abort();
    const controller = new AbortController();
    detailAbort.current = controller;
    setSelectedKey(key);
    setDetail(null);
    setDetailLoading(true);
    setDetailError(null);
    setHighlightQuery(highlight);
    if (highlight.trim()) {
      setFocus("all");
      setHideThinking(false);
      setHideTools(false);
      setCollapseProcess(false);
    }
    setOutlineOpen(false);
    setSidebarOpen(false);
    try {
      window.history.replaceState(null, "", `#/s/${encodeURIComponent(key)}`);
    } catch {
      // Navigation state is best effort.
    }
    try {
      const data = await getSession(key, controller.signal);
      if (!controller.signal.aborted) setDetail(data);
    } catch (error) {
      if (!controller.signal.aborted) {
        setDetailError(error instanceof Error ? error.message : "读取会话失败");
      }
    } finally {
      if (!controller.signal.aborted) setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshList();
    return () => listAbort.current?.abort();
  }, [refreshList]);

  useEffect(() => {
    const saved = window.localStorage.getItem("asm-prefs");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<{
          focus: FocusMode;
          hideThinking: boolean;
          hideTools: boolean;
          collapseProcess: boolean;
          viewMode: "project" | "time";
          theme: "dark" | "light";
        }>;
        if (parsed.focus) setFocus(parsed.focus);
        if (typeof parsed.hideThinking === "boolean") setHideThinking(parsed.hideThinking);
        if (typeof parsed.hideTools === "boolean") setHideTools(parsed.hideTools);
        if (typeof parsed.collapseProcess === "boolean") setCollapseProcess(parsed.collapseProcess);
        if (parsed.viewMode === "time" || parsed.viewMode === "project") setViewMode(parsed.viewMode);
      } catch {
        // Ignore malformed preferences.
      }
    }
    const current = document.documentElement.dataset.theme;
    if (current === "light" || current === "dark") setTheme(current);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      "asm-prefs",
      JSON.stringify({ focus, hideThinking, hideTools, collapseProcess, viewMode }),
    );
  }, [focus, hideThinking, hideTools, collapseProcess, viewMode]);

  useEffect(() => {
    const match = window.location.hash.match(/^#\/s\/(.+)$/);
    if (match) {
      try {
        void openSession(decodeURIComponent(match[1]));
      } catch {
        // Ignore malformed hashes.
      }
    }
  }, [openSession]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        setDeleteTargets(null);
        setOutlineOpen(false);
        setSidebarOpen(false);
        if (document.activeElement === searchRef.current) searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const text = query.trim();
    if (!bodySearch || text.length < 2) {
      setSearch(null);
      setSearching(false);
      setSearchError(null);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    setSearchError(null);
    setSearch(null);
    const timer = window.setTimeout(async () => {
      try {
        const data = await searchSessions(text, agent, controller.signal);
        if (!controller.signal.aborted) setSearch(data);
      } catch (error) {
        if (!controller.signal.aborted) {
          setSearchError(error instanceof Error ? error.message : "检索失败");
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, bodySearch, agent]);

  useEffect(() => {
    if (!selectedKey || !list) return;
    if (!list.sessions.some((session) => session.key === selectedKey)) {
      setSelectedKey(null);
      setDetail(null);
      setDetailError(null);
    }
  }, [list, selectedKey]);

  const sessions = list?.sessions ?? [];
  const agentSessions = useMemo(
    () => sessions.filter((session) => agent === "all" || session.agent === agent),
    [sessions, agent],
  );
  const counts = useMemo(() => computeCounts(agentSessions), [agentSessions]);
  const filteredSessions = useMemo(() => {
    const text = query.trim().toLowerCase();
    return agentSessions.filter((session) => {
      if (status === "recent" && Date.now() - session.mtime * 1000 >= 7 * 24 * 3600 * 1000) return false;
      if (status === "children" && !session.isChild) return false;
      if (!text) return true;
      if (bodySearch && text.length >= 2) return true;
      return [session.title, session.cwd, session.project, session.firstUser, session.sessionId]
        .join("\n")
        .toLowerCase()
        .includes(text);
    });
  }, [agentSessions, status, query, bodySearch]);

  const selectedMeta = useMemo(
    () => sessions.filter((session) => selected.has(session.key)),
    [sessions, selected],
  );

  const toggleSelected = useCallback((key: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectMany = useCallback((keys: string[]) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const key of keys) next.add(key);
      return next;
    });
  }, []);

  const clearSelected = useCallback(() => setSelected(new Set()), []);

  const changeBatchMode = useCallback(
    (value: boolean) => {
      setBatchMode(value);
      setSelected(new Set());
      if (value) setBodySearch(false);
    },
    [],
  );

  const requestDelete = useCallback(() => {
    if (batchMode) {
      if (selectedMeta.length > 0) setDeleteTargets(selectedMeta);
      return;
    }
    if (detail) setDeleteTargets([detail]);
  }, [batchMode, detail, selectedMeta]);

  const confirmDelete = useCallback(
    async (keys: string[], cascade: boolean): Promise<DeleteResult> => {
      const result = await deleteSessions(keys, cascade);
      if (result.deleted.length > 0) {
        showToast(`已永久删除 ${result.deleted.length} 个会话文件`);
        setSelected(new Set());
        setBatchMode(false);
        setSelectedKey(null);
        setDetail(null);
        setDetailError(null);
        window.history.replaceState(null, "", window.location.pathname);
        await refreshList();
      }
      return result;
    },
    [refreshList, showToast],
  );

  const toggleTheme = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("asm-theme", next);
  }, [theme]);

  return (
    <div className={`app ${sidebarOpen ? "sidebar-open" : ""}`}>
      <Sidebar
        sessions={filteredSessions}
        counts={counts}
        roots={list?.roots ?? []}
        loading={loading}
        listError={listError}
        elapsedMs={list?.elapsedMs ?? 0}
        scannedFiles={list?.scannedFiles ?? 0}
        agent={agent}
        onAgent={setAgent}
        status={status}
        onStatus={setStatus}
        viewMode={viewMode}
        onViewMode={setViewMode}
        query={query}
        onQuery={updateQuery}
        bodySearch={bodySearch}
        onBodySearch={setBodySearch}
        search={search}
        searching={searching}
        searchError={searchError}
        selectedKey={selectedKey}
        onSelect={(key, highlight) => void openSession(key, highlight)}
        onRefresh={() => void refreshList()}
        theme={theme}
        onTheme={toggleTheme}
        batchMode={batchMode}
        onBatchMode={changeBatchMode}
        selected={selected}
        onToggleSelected={toggleSelected}
        onSelectMany={selectMany}
        onClearSelected={clearSelected}
        onRequestDelete={requestDelete}
        searchRef={searchRef}
      />

      {selectedKey || detailLoading ? (
        <Reader
          detail={detail}
          loading={detailLoading}
          error={detailError}
          focus={focus}
          setFocus={setFocus}
          hideThinking={hideThinking}
          setHideThinking={setHideThinking}
          hideTools={hideTools}
          setHideTools={setHideTools}
          collapseProcess={collapseProcess}
          setCollapseProcess={setCollapseProcess}
          outlineOpen={outlineOpen}
          setOutlineOpen={setOutlineOpen}
          highlightQuery={highlightQuery}
          onDelete={requestDelete}
          onToast={showToast}
          onMenu={() => setSidebarOpen(true)}
          onOpenSession={(key) => void openSession(key)}
        />
      ) : (
        <Welcome
          list={list}
          loading={loading}
          error={listError}
          onRefresh={() => void refreshList()}
          onFirst={() => {
            const first = filteredSessions[0] ?? sessions[0];
            if (first) void openSession(first.key);
          }}
          onMenu={() => setSidebarOpen(true)}
        />
      )}

      <button
        type="button"
        className={`mobile-backdrop ${sidebarOpen ? "on" : ""}`}
        aria-label="关闭会话列表"
        onClick={() => setSidebarOpen(false)}
      />

      {deleteTargets ? (
        <DeleteDialog
          targets={deleteTargets}
          onClose={() => setDeleteTargets(null)}
          onConfirm={confirmDelete}
        />
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

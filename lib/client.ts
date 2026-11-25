import type {
  DeleteResult,
  SearchResponse,
  SessionDetail,
  SessionListResponse,
} from "./types";

async function requestJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    let message = `请求失败 (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Keep the status-based message.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export function getSessions(signal?: AbortSignal): Promise<SessionListResponse> {
  return requestJSON<SessionListResponse>("/api/sessions", { signal });
}

export function getSession(key: string, signal?: AbortSignal): Promise<SessionDetail> {
  return requestJSON<SessionDetail>(`/api/sessions/${encodeURIComponent(key)}`, { signal });
}

export function searchSessions(
  query: string,
  agent: string,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query, agent });
  return requestJSON<SearchResponse>(`/api/search?${params.toString()}`, { signal });
}

export function deleteSessions(keys: string[], cascade: boolean): Promise<DeleteResult> {
  return requestJSON<DeleteResult>("/api/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys, cascade, confirm: "DELETE" }),
  });
}

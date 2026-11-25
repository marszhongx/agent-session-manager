import { NextRequest, NextResponse } from "next/server";
import { listSessions } from "@/lib/sessions";
import type { SessionStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const agent = url.searchParams.get("agent") ?? "all";
    const statusRaw = url.searchParams.get("status") ?? "all";
    const status: SessionStatus =
      statusRaw === "recent" || statusRaw === "children" ? statusRaw : "all";
    const data = listSessions({
      agent,
      status,
      query: url.searchParams.get("q") ?? "",
    });
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取会话目录失败" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

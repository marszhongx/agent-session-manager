import { NextRequest, NextResponse } from "next/server";
import { searchSessions } from "@/lib/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const agent = url.searchParams.get("agent") ?? "all";
  const limit = Number(url.searchParams.get("limit") ?? 80);
  try {
    const data = await searchSessions(query, { agent, limit: Number.isFinite(limit) ? limit : 80 });
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "检索失败" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { deleteSessions } from "@/lib/delete";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { keys?: unknown; cascade?: unknown; confirm?: unknown };
    if (body.confirm !== "DELETE") {
      return NextResponse.json({ error: "请输入 DELETE 以确认永久删除" }, { status: 400 });
    }
    if (!Array.isArray(body.keys) || body.keys.some((key) => typeof key !== "string")) {
      return NextResponse.json({ error: "会话列表无效" }, { status: 400 });
    }
    const result = deleteSessions(body.keys as string[], Boolean(body.cascade));
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "清理失败";
    const status = /刚刚被写入|仍在运行/.test(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

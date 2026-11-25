import { NextResponse } from "next/server";
import { getSessionDetail } from "@/lib/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ key: string }> }) {
  try {
    const { key } = await context.params;
    const detail = getSessionDetail(decodeURIComponent(key));
    return NextResponse.json(detail, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取会话失败";
    const status = /不存在|越界|无效|不支持|拒绝/.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

import { NextResponse } from "next/server";
import { getSessionDetail } from "@/lib/sessions";
import { detailToMarkdown } from "@/lib/parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asciiName(value: string): string {
  const cleaned = value.replace(/[^\x20-\x7E]+/g, "").replace(/["\\]/g, "").trim();
  return (cleaned || "session").slice(0, 80);
}

function safeFileName(value: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|]+/g, "-").replace(/[. ]+$/g, "").trim();
  return (cleaned || "session").slice(0, 80);
}

export async function GET(request: Request, context: { params: Promise<{ key: string }> }) {
  try {
    const { key } = await context.params;
    const url = new URL(request.url);
    const detail = getSessionDetail(decodeURIComponent(key));
    const markdown = detailToMarkdown(detail, {
      thinking: url.searchParams.get("thinking") !== "0",
      tools: url.searchParams.get("tools") !== "0",
    });
    const fileName = safeFileName(detail.title || "session");
    const fallback = `${asciiName(fileName)}.md`;
    const encoded = encodeURIComponent(`${fileName}.md`);
    return new Response(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "导出失败" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
}

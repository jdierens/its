import { NextRequest, NextResponse } from "next/server";
import { errorText } from "@/lib/errors";
import { projectReceiptFile } from "@/lib/receivingActions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function readBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    try {
      const body = await request.json();
      return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    } catch {
      return null;
    }
  }
  try {
    const form = await request.formData();
    const payload = form.get("payload");
    if (typeof payload !== "string") return null;
    const body = JSON.parse(payload) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function errorResponse(request: NextRequest, message: string, status: number) {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    const html =
      `<!doctype html><meta charset="utf-8"><title>Export</title>` +
      `<p>${htmlEscape(message)}</p><p><a href="/warehouse/receiving">Back to receiving</a></p>`;
    return new NextResponse(html, {
      status,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return NextResponse.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

function statusFor(message: string): number {
  if (message === "Sign in required.") return 401;
  if (message === "This account cannot change data.") return 403;
  return 400;
}

function reportKind(value: unknown): "summary" | "detail" | null {
  return value === "summary" || value === "detail" ? value : null;
}

export async function POST(request: NextRequest) {
  const body = await readBody(request);
  if (!body) return errorResponse(request, "Export failed.", 400);
  const kind = reportKind(body.kind);
  if (!kind) return errorResponse(request, "Choose a summary or a receipt export.", 400);
  const project = typeof body.project === "string" ? body.project : "";
  try {
    const file = await projectReceiptFile(project, kind);
    return new NextResponse(file.csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${file.filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const message = errorText(error);
    return errorResponse(request, message, statusFor(message));
  }
}

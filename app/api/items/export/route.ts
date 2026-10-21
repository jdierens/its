import { NextRequest, NextResponse } from "next/server";
import { ExportDenied, requireExportActor } from "@/lib/export/access";
import { loadExportItems } from "@/lib/export/load";
import { buildExportTable, exportTitle, toCsv } from "@/lib/export/table";
import { toXlsx } from "@/lib/export/xlsx";
import { readGoogleRefreshToken } from "@/lib/google/grants";
import { createUserSpreadsheet, readGoogleOAuth, refreshGoogleAccess } from "@/lib/google/sheets";
import { publicOrigin } from "@/lib/ebay/origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function columnsOf(value: unknown): "all" | string[] {
  if (value === "all" || value == null) return "all";
  if (!Array.isArray(value)) return "all";
  return value.filter((item): item is string => typeof item === "string");
}

function idsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function fileName(title: string, extension: string): string {
  return `${title.replaceAll(":", "-")}.${extension}`;
}

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
      `<p>${htmlEscape(message)}</p><p><a href="/items">Back to items</a></p>`;
    return new NextResponse(html, {
      status,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  return NextResponse.json(
    { google: Boolean(readGoogleOAuth(process.env)) },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const record = await readBody(request);
  if (!record) return errorResponse(request, "Export request was empty.", 400);

  const format = record.format === "sheet" || record.format === "csv" || record.format === "xlsx" ? record.format : null;
  if (!format) return errorResponse(request, "Choose a format.", 400);

  try {
    const actor = await requireExportActor();
    const loaded = await loadExportItems({
      tax: text(record.tax),
      q: text(record.q),
      condition: text(record.condition),
      manufacturerId: text(record.manufacturerId),
      itemType: text(record.itemType),
      sort: text(record.sort),
      dir: text(record.dir),
      selectedIds: idsOf(record.selectedIds),
      includeMoney: actor.canViewFinancials,
    });
    if (loaded.unknownTax) {
      const code = text(record.tax).trim().toUpperCase();
      return errorResponse(request, `No taxonomy uses the short code ${code}.`, 400);
    }

    const table = buildExportTable(loaded.items, {
      columns: columnsOf(record.columns),
      includeMoney: actor.canViewFinancials,
    });
    const title = exportTitle(new Date());

    if (format === "csv") {
      const name = fileName(title, "csv");
      return new NextResponse(toCsv(table), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${name}"`,
          "cache-control": "no-store",
        },
      });
    }

    if (format === "xlsx") {
      const name = fileName(title, "xlsx");
      const bytes = toXlsx(table);
      return new NextResponse(Buffer.from(bytes), {
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": `attachment; filename="${name}"`,
          "cache-control": "no-store",
        },
      });
    }

    const config = readGoogleOAuth(process.env);
    if (!config) return errorResponse(request, "Google Sheets is not configured.", 409);
    const origin = publicOrigin(request);
    const consentUrl = `${origin}/api/items/export/google/start`;
    const refresh = await readGoogleRefreshToken(actor.id);
    if (!refresh) return NextResponse.json({ consentUrl });

    let accessToken: string;
    try {
      accessToken = await refreshGoogleAccess({ config, refreshToken: refresh });
    } catch {
      return NextResponse.json({ consentUrl });
    }
    const sheet = await createUserSpreadsheet({
      accessToken,
      title,
      headers: table.headers,
      rows: table.rows,
    });
    return NextResponse.json({ url: sheet.url });
  } catch (error) {
    if (error instanceof ExportDenied) {
      return errorResponse(request, error.message, error.status);
    }
    const message = error instanceof Error && error.message ? error.message : "Export failed.";
    return errorResponse(request, message, 500);
  }
}

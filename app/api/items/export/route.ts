import { NextRequest, NextResponse } from "next/server";
import { publicOrigin } from "@/lib/ebay/origin";
import { loadExportItems } from "@/lib/export/load";
import { buildExportTable, exportTitle, toCsv } from "@/lib/export/table";
import { createItemsSpreadsheet, readGoogleExport } from "@/lib/google/sheets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function GET() {
  return NextResponse.json({ google: Boolean(readGoogleExport(process.env)) });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Export request was empty." }, { status: 400 });
  }

  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const format = record.format === "sheet" || record.format === "csv" ? record.format : null;
  const scope = record.scope === "all" || record.scope === "view" ? record.scope : null;
  if (!format || !scope) {
    return NextResponse.json({ error: "Choose a format and what to export." }, { status: 400 });
  }

  try {
    const loaded = await loadExportItems({
      scope,
      tax: text(record.tax),
      q: text(record.q),
      condition: text(record.condition),
      manufacturerId: text(record.manufacturerId),
      itemType: text(record.itemType),
      origin: publicOrigin(request),
    });
    if (loaded.unknownTax) {
      const code = text(record.tax).trim().toUpperCase();
      return NextResponse.json({ error: `No taxonomy uses the short code ${code}.` }, { status: 400 });
    }

    const table = buildExportTable(loaded.items, loaded.pricingKeys);
    if (format === "csv") {
      const title = exportTitle(new Date()).replaceAll(":", "-");
      return new NextResponse(toCsv(table), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${title}.csv"`,
          "cache-control": "no-store",
        },
      });
    }

    const config = readGoogleExport(process.env);
    if (!config) return NextResponse.json({ error: "Not configured" }, { status: 409 });

    const now = new Date();
    const sheet = await createItemsSpreadsheet({
      config,
      title: exportTitle(now),
      headers: table.headers,
      rows: table.rows,
      now,
    });
    return NextResponse.json({ url: sheet.url });
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "Export failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

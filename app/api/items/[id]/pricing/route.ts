import { NextResponse } from "next/server";
import { collapseLabel } from "@/lib/itemFields";
import { collectPriceQuotes } from "@/lib/pricing/providers";
import { flagOutliers } from "@/lib/pricing/quotes";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ message: "That item was not found." }, { status: 404 });
  }

  const supabase = await getSupabase();
  const item = await supabase.from("items").select("id, part_number, model").eq("id", id).maybeSingle();
  if (item.error) return NextResponse.json({ message: item.error.message }, { status: 400 });
  if (!item.data) return NextResponse.json({ message: "That item was not found." }, { status: 404 });

  const query = collapseLabel(String(item.data.part_number ?? "")) || collapseLabel(String(item.data.model ?? "")) || "";
  const reports = await collectPriceQuotes({
    query,
    env: {
      EBAY_CLIENT_ID: process.env.EBAY_CLIENT_ID,
      EBAY_CLIENT_SECRET: process.env.EBAY_CLIENT_SECRET,
      EBAY_ENVIRONMENT: process.env.EBAY_ENVIRONMENT,
      EBAY_INSIGHTS_ENABLED: process.env.EBAY_INSIGHTS_ENABLED,
      BROKERBIN_API_KEY: process.env.BROKERBIN_API_KEY,
    },
  });
  const drafts = flagOutliers(reports.flatMap((report) => report.quotes));
  const capturedAt = new Date().toISOString();

  if (drafts.length > 0) {
    const inserted = await supabase.from("price_quotes").insert(
      drafts.map((quote) => ({
        item_id: id,
        source: quote.source,
        price: quote.price,
        currency: quote.currency,
        qty: quote.qty,
        condition: quote.condition,
        seller_name: quote.sellerName,
        url: quote.url,
        notes: quote.notes,
        captured_at: capturedAt,
        captured_by: "update-pricing",
        raw: quote.raw,
        outlier: quote.outlier,
      })),
    );
    if (inserted.error) return NextResponse.json({ message: inserted.error.message }, { status: 400 });
  }

  const marked = await supabase.from("items").update({ pricing_checked_at: capturedAt }).eq("id", id);
  if (marked.error) return NextResponse.json({ message: marked.error.message }, { status: 400 });

  return NextResponse.json({
    checkedAt: capturedAt,
    query,
    reports: reports.map((report) => ({
      source: report.source,
      label: report.label,
      status: report.status,
      count: report.count,
      message: report.message,
    })),
    inserted: drafts.length,
    outliers: drafts.filter((quote) => quote.outlier).length,
  });
}

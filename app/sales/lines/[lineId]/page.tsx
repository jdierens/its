"use client";

import { useParams } from "next/navigation";
import { SoKitLine } from "@/components/SoKitLine";

export default function SalesKitLinePage() {
  const params = useParams<{ lineId: string }>();
  const lineId = Array.isArray(params.lineId) ? params.lineId[0] : params.lineId;
  return (
    <main className="page kit-page">
      <h1>Sales order line</h1>
      {lineId ? <SoKitLine lineId={lineId} /> : <p>Missing line.</p>}
    </main>
  );
}

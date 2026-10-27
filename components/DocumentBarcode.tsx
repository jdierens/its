"use client";

import JsBarcode from "jsbarcode";
import { useLayoutEffect, useRef } from "react";

/** Code 39 of the document number. Confirmation is SO plus the number. Invoice is INV plus the number. */
export function DocumentBarcode({ value }: { value: string }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg || !value) return;
    JsBarcode(svg, value, {
      format: "CODE39",
      width: 1.15,
      height: 42,
      margin: 0,
      displayValue: true,
      font: '"Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif',
      fontSize: 12,
      textMargin: 2,
      background: "#ffffff",
      lineColor: "#000000",
    });
  }, [value]);

  return <svg className="cust-doc-barcode" ref={svgRef} role="img" aria-label={value} />;
}

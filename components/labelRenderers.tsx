"use client";

import type { ComponentType } from "react";
import { ItemLabel } from "@/components/ItemLabel";
import { QrItemLabel } from "@/components/QrItemLabel";
import type { LabelTemplateId } from "@/lib/labelTemplates";

export type PrintedLabelProps = {
  name: string;
  description: string;
  code: string;
  sku: string;
  itemId: string;
  origin: string;
  quantity: string;
  shortCode?: string | null;
  printedOn: string;
};

function BarcodeTemplate({
  name,
  description,
  code,
  quantity,
  shortCode,
  printedOn,
}: PrintedLabelProps) {
  return (
    <ItemLabel
      name={name}
      description={description}
      code={code}
      quantity={quantity}
      shortCode={shortCode}
      printedOn={printedOn}
    />
  );
}

function QrTemplate({ name, sku, itemId, origin, quantity, shortCode, printedOn }: PrintedLabelProps) {
  return (
    <QrItemLabel
      name={name}
      sku={sku}
      itemId={itemId}
      origin={origin}
      quantity={quantity}
      shortCode={shortCode}
      printedOn={printedOn}
    />
  );
}

// Add a template by listing it in LABEL_TEMPLATES and registering a renderer here.
const LABEL_RENDERERS: Record<LabelTemplateId, ComponentType<PrintedLabelProps>> = {
  barcode: BarcodeTemplate,
  qr: QrTemplate,
};

export function PrintedLabel({
  template,
  ...props
}: PrintedLabelProps & { template: LabelTemplateId }) {
  const Renderer = LABEL_RENDERERS[template] ?? LABEL_RENDERERS.barcode;
  return <Renderer {...props} />;
}

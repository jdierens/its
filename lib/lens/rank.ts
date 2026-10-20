export type LensReading = {
  manufacturer: string;
  partNumbers: string[];
  model: string;
  itemType: string;
  taxonomy: string;
  specs: { name: string; value: string }[];
  specCodes: string[];
  conditionHints: string;
  rawText: string;
  confidence: number;
};

export type LensCandidate = {
  id: string;
  sku: string;
  name: string;
  partNumber: string;
  oemPartNumber: string;
  model: string;
  manufacturerName: string;
  taxonomyName: string;
  specCode: string;
  quantity: number | null;
  skuSimilarity: number;
  partSimilarity: number;
  oemSimilarity: number;
  modelSimilarity: number;
  specSimilarity: number;
};

export type LensHit = {
  id: string;
  sku: string;
  name: string;
  manufacturer: string;
  taxonomy: string;
  confidence: number;
  reasons: string[];
  /** Item quantity today. Warehouse stock can be shown beside this later. */
  quantity: number | null;
};

const EXACT = {
  sku: 1,
  partNumber: 0.96,
  oemPartNumber: 0.96,
  specCode: 0.92,
  model: 0.84,
} as const;

const FUZZY = {
  sku: 0.72,
  partNumber: 0.7,
  oemPartNumber: 0.7,
  specCode: 0.66,
  model: 0.55,
} as const;

const FUZZY_FLOOR = 0.45;
const SCORE_FLOOR = 0.4;

export function normalizeToken(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function lensNeedles(reading: Pick<LensReading, "partNumbers" | "model" | "specCodes">): string[] {
  const seen = new Set<string>();
  const needles: string[] = [];
  for (const value of [...reading.partNumbers, reading.model, ...reading.specCodes]) {
    const trimmed = value.trim();
    const token = normalizeToken(trimmed);
    if (token.length < 3 || seen.has(token)) continue;
    seen.add(token);
    needles.push(trimmed);
    if (needles.length === 12) break;
  }
  return needles;
}

export function rankLensMatches(reading: LensReading, candidates: LensCandidate[]): LensHit[] {
  const needles = new Set(lensNeedles(reading).map(normalizeToken));
  const hits: LensHit[] = [];
  for (const candidate of candidates) {
    const scored = scoreCandidate(reading, candidate, needles);
    if (!scored) continue;
    hits.push(scored);
  }
  hits.sort((a, b) => b.confidence - a.confidence || a.sku.localeCompare(b.sku) || a.name.localeCompare(b.name));
  return hits.slice(0, 12);
}

function scoreCandidate(reading: LensReading, candidate: LensCandidate, needles: Set<string>): LensHit | null {
  const fields = [
    { key: "sku" as const, label: "SKU", value: candidate.sku, similarity: candidate.skuSimilarity },
    { key: "partNumber" as const, label: "Part number", value: candidate.partNumber, similarity: candidate.partSimilarity },
    { key: "oemPartNumber" as const, label: "OEM part number", value: candidate.oemPartNumber, similarity: candidate.oemSimilarity },
    { key: "specCode" as const, label: "Spec code", value: candidate.specCode, similarity: candidate.specSimilarity },
    { key: "model" as const, label: "Model", value: candidate.model, similarity: candidate.modelSimilarity },
  ];
  let best = 0;
  const reasons: string[] = [];
  for (const field of fields) {
    const token = normalizeToken(field.value);
    const exact = token.length > 0 && needles.has(token);
    if (exact) {
      best = Math.max(best, EXACT[field.key]);
      reasons.push(`${field.label} matches ${field.value.trim()}`);
      continue;
    }
    if (field.similarity >= FUZZY_FLOOR && fuzzyAllowed(field.key, field.value)) {
      const fuzzy = field.similarity * FUZZY[field.key];
      if (fuzzy >= 0.3) {
        best = Math.max(best, fuzzy);
        reasons.push(`Similar ${field.label.toLowerCase()}`);
      }
    }
  }
  if (best === 0) return null;
  if (namesMatch(reading.manufacturer, candidate.manufacturerName)) {
    best += 0.06;
    reasons.push(`Manufacturer ${candidate.manufacturerName.trim()}`);
  }
  if (namesMatch(reading.taxonomy, candidate.taxonomyName)) {
    best += 0.05;
    reasons.push(`Taxonomy ${candidate.taxonomyName.trim()}`);
  }
  const confidence = Math.min(1, Math.round(best * 1000) / 1000);
  if (confidence < SCORE_FLOOR) return null;
  return {
    id: candidate.id,
    sku: candidate.sku,
    name: candidate.name,
    manufacturer: candidate.manufacturerName,
    taxonomy: candidate.taxonomyName,
    confidence,
    reasons,
    quantity: candidate.quantity,
  };
}

function fuzzyAllowed(key: string, value: string): boolean {
  if (key !== "sku") return true;
  return !/^\d{4,8}$/.test(value.trim());
}

function namesMatch(left: string, right: string): boolean {
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();
  return a.length > 0 && a === b;
}

export function suggestedItemName(reading: LensReading): string {
  const titled = [reading.manufacturer, reading.model].map((part) => part.trim()).filter(Boolean).join(" ");
  if (titled) return titled;
  return reading.partNumbers[0]?.trim() || "Identified item";
}

export function conditionFromHints(hints: string): "New" | "Used" {
  return /\b(new|sealed|unused|factory)\b/i.test(hints) ? "New" : "Used";
}

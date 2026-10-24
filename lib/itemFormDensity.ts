const MEMORY_SLOTS = ["family", "speed", "capacity", "ranking", "form_factor"] as const;

export type MemorySlot = (typeof MEMORY_SLOTS)[number];

const MEMORY_ALIASES: Record<string, MemorySlot> = {
  family: "family",
  speed: "speed",
  capacity: "capacity",
  capacity_gb: "capacity",
  ranking: "ranking",
  rank: "ranking",
  form_factor: "form_factor",
  formfactor: "form_factor",
};

export function isMemoryTaxonomy(shortCode: string | null | undefined): boolean {
  return (shortCode ?? "").trim().toUpperCase() === "MEM";
}

export function memoryAttributeSlot(name: string): MemorySlot | null {
  const key = name.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return MEMORY_ALIASES[key] ?? null;
}

export function memorySlotRank(slot: MemorySlot): number {
  return MEMORY_SLOTS.indexOf(slot);
}

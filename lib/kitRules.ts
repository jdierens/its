export const KIT_SERVER_CODE = "KIT/SRV";
export const KIT_BUNDLE_CODE = "KIT/BDL";
export const SERVER_ECCN = "5A992.C";

export type KitChild = {
  id: string;
  longCode: string | null;
  condition: string | null;
  eccn: string | null;
};

export type KitDefaults = {
  condition: string | null;
  eccn: string | null;
  needsChoice: boolean;
  message: string | null;
};

/** Keep a name as it was given. Kit slashes stay slashes, and product backslashes stay backslashes. */
export function keepKitName(name: string): string {
  return name.trim();
}

export function isChassisCode(longCode: string | null): boolean {
  if (!longCode) return false;
  const code = longCode.trim().toUpperCase();
  return code === "SYS/SRV" || code.startsWith("CHA/");
}

export function kitFieldDefaults(taxonomyCode: string, children: KitChild[]): KitDefaults {
  const code = taxonomyCode.trim().toUpperCase();
  if (code === KIT_BUNDLE_CODE) {
    if (children.length !== 1) {
      return {
        condition: null,
        eccn: null,
        needsChoice: true,
        message: "A kit bundle must have exactly one component.",
      };
    }
    return {
      condition: children[0].condition,
      eccn: children[0].eccn,
      needsChoice: false,
      message: null,
    };
  }
  if (code !== KIT_SERVER_CODE) {
    return {
      condition: null,
      eccn: null,
      needsChoice: true,
      message: "Choose Kit server or Kit bundle.",
    };
  }
  const chassis = children.filter((child) => isChassisCode(child.longCode));
  if (chassis.length !== 1) {
    return {
      condition: null,
      eccn: SERVER_ECCN,
      needsChoice: true,
      message: "Choose a condition. This server kit needs one chassis.",
    };
  }
  return {
    condition: chassis[0].condition,
    eccn: SERVER_ECCN,
    needsChoice: false,
    message: null,
  };
}

/** True when the sales-order tables this screen reads have not been created yet. */
export function salesTableMissing(error: { code?: string | null; message?: string | null }): boolean {
  const code = error.code ?? "";
  const message = error.message ?? "";
  return code === "PGRST205" || code === "42P01" || /schema cache|relation .* does not exist/i.test(message);
}

export function genericStillNeedsPart(input: {
  plannedGeneric: boolean;
  actualGeneric: boolean | null;
  hasActual: boolean;
}): boolean {
  if (input.hasActual && input.actualGeneric === true) return true;
  if (!input.plannedGeneric) return false;
  if (!input.hasActual) return true;
  return input.actualGeneric !== false;
}

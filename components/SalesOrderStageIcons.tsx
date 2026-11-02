import { BadgeCheck, Ban, FileText, Package, PackageCheck, Truck, type LucideIcon } from "lucide-react";
import type { SalesOrderStageIcon, SalesOrderStageIconId } from "@/lib/salesOrderStageIcons";

const ICONS: Record<SalesOrderStageIconId, LucideIcon> = {
  approved: BadgeCheck,
  picked: PackageCheck,
  packed: Package,
  shipped: Truck,
  invoiced: FileText,
  cancelled: Ban,
};

export function SalesOrderStageIcons({ stages }: { stages: SalesOrderStageIcon[] }) {
  return (
    <span className="so-stage-icons" role="group" aria-label="Order stages">
      {stages.map((stage) => {
        const Icon = ICONS[stage.id];
        return (
          <span
            key={stage.id}
            className={`so-stage-icon so-stage-${stage.tone}${stage.id === "cancelled" ? " so-stage-cancel" : ""}`}
            title={stage.title}
            aria-label={stage.title}
          >
            <Icon size={14} strokeWidth={2} aria-hidden />
          </span>
        );
      })}
    </span>
  );
}

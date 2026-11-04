import { BadgeCheck, Banknote, Ban, FileText, Package, PackageCheck, Truck, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { salesOrderStageIconHref, type SalesOrderStageIcon, type SalesOrderStageIconId } from "@/lib/salesOrderStageIcons";

const ICONS: Record<SalesOrderStageIconId, LucideIcon> = {
  approved: BadgeCheck,
  picked: PackageCheck,
  packed: Package,
  shipped: Truck,
  invoiced: FileText,
  paid: Banknote,
  cancelled: Ban,
};

export function SalesOrderStageIcons({
  stages,
  orderId,
}: {
  stages: SalesOrderStageIcon[];
  /** When set, icons that have a page open that process for this order. */
  orderId?: string | null;
}) {
  return (
    <span className="so-stage-icons" role="group" aria-label="Order stages">
      {stages.map((stage) => {
        const Icon = ICONS[stage.id];
        const className = `so-stage-icon so-stage-${stage.tone}${stage.id === "cancelled" ? " so-stage-cancel" : ""}`;
        const href = salesOrderStageIconHref(stage.id, orderId);
        const icon = <Icon size={14} strokeWidth={2} aria-hidden />;
        if (!href) {
          return (
            <span key={stage.id} className={className} title={stage.title} aria-label={stage.title}>
              {icon}
            </span>
          );
        }
        return (
          <Link key={stage.id} href={href} className={className} title={stage.title} aria-label={stage.title}>
            {icon}
          </Link>
        );
      })}
    </span>
  );
}

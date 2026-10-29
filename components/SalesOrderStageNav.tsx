import { ChevronLeft, ChevronRight, ClipboardList, Package, PackageCheck, Truck, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { salesOrderStageNav, type SalesOrderStage, type SalesOrderStageId } from "@/lib/salesOrderStages";

const MARK: Record<SalesOrderStageId, { short: string; Icon: LucideIcon }> = {
  order: { short: "Order", Icon: ClipboardList },
  pick: { short: "Pick", Icon: PackageCheck },
  pack: { short: "Pack", Icon: Package },
  ship: { short: "Ship", Icon: Truck },
};

function stageName(stage: SalesOrderStage): string {
  return stage.reason ? `${stage.label}. ${stage.reason}` : stage.label;
}

function StageControl({ stage }: { stage: SalesOrderStage }) {
  const { short, Icon } = MARK[stage.id];
  const name = stageName(stage);
  const body = (
    <>
      <Icon size={15} strokeWidth={1.75} aria-hidden />
      <span>{short}</span>
    </>
  );
  if (stage.current) {
    return (
      <span className="so-stage so-stage-current" aria-current="page" aria-label={stage.label} title={stage.label}>
        {body}
      </span>
    );
  }
  if (stage.href) {
    return (
      <Link className="so-stage" href={stage.href} aria-label={stage.label} title={stage.label}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" className="so-stage" disabled aria-label={name} title={name}>
      {body}
    </button>
  );
}

function Step({ direction, stage }: { direction: "previous" | "next"; stage: SalesOrderStage | null }) {
  const label = direction === "previous" ? "Previous stage" : "Next stage";
  const Icon = direction === "previous" ? ChevronLeft : ChevronRight;
  const icon = <Icon size={16} strokeWidth={1.75} aria-hidden />;
  if (stage?.href) {
    return (
      <Link className="so-stage-jump" href={stage.href} aria-label={label} title={label}>
        {icon}
      </Link>
    );
  }
  return (
    <button type="button" className="so-stage-jump" disabled aria-label={label} title={label}>
      {icon}
    </button>
  );
}

export function SalesOrderStageNav({
  orderId,
  status,
  pickStatus = null,
  numbered,
  current,
}: {
  orderId: string;
  status: string;
  pickStatus?: string | null;
  numbered: boolean;
  current: SalesOrderStageId;
}) {
  const model = salesOrderStageNav({ orderId, status, pickStatus, numbered, current });
  return (
    <nav className="so-stage-nav no-print" aria-label="Sales order stages">
      <Step direction="previous" stage={model.previous} />
      <ol>
        {model.stages.map((stage) => (
          <li key={stage.id}>
            <StageControl stage={stage} />
          </li>
        ))}
      </ol>
      <Step direction="next" stage={model.next} />
    </nav>
  );
}

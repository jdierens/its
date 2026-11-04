import { Badge } from "@/components/ui/badge";
import { displayAxes, quoteDirectionLabel, quoteDirectionTone, quoteFlowLabel, quoteSideLabel, quoteSideTone } from "@/lib/quoteReviews";

export function QuoteFlowMarks({ side, direction }: { side: string; direction: string }) {
  const axes = displayAxes(side, direction);
  return (
    <span className="qr-flow">
      <span className="qr-flow-name">{quoteFlowLabel(axes.side, axes.direction)}</span>
      <Badge tone={quoteSideTone(axes.side)}>{quoteSideLabel(axes.side)}</Badge>
      <Badge tone={quoteDirectionTone(axes.direction)}>{quoteDirectionLabel(axes.direction)}</Badge>
    </span>
  );
}

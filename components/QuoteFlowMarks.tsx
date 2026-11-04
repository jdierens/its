import { Badge } from "@/components/ui/badge";
import { quoteDirectionLabel, quoteDirectionTone, quoteFlowLabel, quoteSideLabel, quoteSideTone } from "@/lib/quoteReviews";

export function QuoteFlowMarks({ side, direction }: { side: string; direction: string }) {
  return (
    <span className="qr-flow">
      <Badge tone={quoteSideTone(side)}>{quoteSideLabel(side)}</Badge>
      <Badge tone={quoteDirectionTone(direction)}>{quoteDirectionLabel(direction)}</Badge>
      <span className="qr-flow-name">{quoteFlowLabel(side, direction)}</span>
    </span>
  );
}

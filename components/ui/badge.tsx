import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const TONES = [
  "neutral",
  "draft",
  "open",
  "partially_received",
  "received",
  "closed",
  "cancelled",
  "approved",
  "pending",
  "disabled",
] as const;

type Tone = (typeof TONES)[number];

const badgeVariants = cva("badge", {
  variants: {
    tone: {
      neutral: "badge-neutral",
      draft: "badge-draft",
      open: "badge-open",
      partially_received: "badge-open",
      received: "badge-received",
      closed: "badge-closed",
      cancelled: "badge-cancelled",
      approved: "badge-approved",
      pending: "badge-pending",
      disabled: "badge-disabled",
    },
  },
  defaultVariants: {
    tone: "neutral",
  },
});

function knownTone(tone: string | null | undefined): Tone {
  return TONES.find((item) => item === tone) ?? "neutral";
}

export function Badge({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLSpanElement> & Omit<VariantProps<typeof badgeVariants>, "tone"> & { tone?: string | null }) {
  return <span className={cn(badgeVariants({ tone: knownTone(tone) }), className)} {...props} />;
}

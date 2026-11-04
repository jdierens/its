import type { CSSProperties, InputHTMLAttributes } from "react";
import { quoteFieldChars } from "@/lib/quoteReviews";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  /** Shortest width, in characters, so an empty field stays usable. */
  floor: number;
  /** Longest width, in characters. Extra text scrolls inside the field. */
  cap: number;
};

/** Text field that tracks the value in it, between a floor and a cap. */
export function QuoteFitInput({ floor, cap, className, value, placeholder, style, ...props }: Props) {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  const hint = typeof placeholder === "string" ? placeholder : "";
  const fit = { "--qr-floor": floor, "--qr-cap": cap } as CSSProperties;
  return (
    <input
      {...props}
      className={className ? `qr-fit ${className}` : "qr-fit"}
      value={value}
      placeholder={placeholder}
      size={quoteFieldChars(text, floor, cap, hint)}
      style={{ ...fit, ...style }}
    />
  );
}

import { errorText } from "@/lib/errors";

const MIGRATION = "Apply supabase/migrations/20261024070800_sales_orders.sql before using sales orders.";

const KNOWN_SALES_ERROR =
  /Choose a customer\.|Choose a channel\.|Choose a payment method\.|Enter a valid amount\.|Enter a payment date\.|Enter a unit price\.|Sales rep initials are 2 letters\.|That sales order can no longer be edited\.|Sales order not found\.|Enter a quantity above 0\.|Only a draft can be approved\.|Enter the order date\.|Enter a bill-to address\.|Enter a ship-to address\.|Choose terms\.|Choose a ship method\.|Enter the sales rep initials\.|Enter a sales order number\.|Add a line before approving\.|Line \d+ needs a mapped SKU\.|Line \d+ must be allocated to SKUs that add up to the quantity\.|Sales order number SO\d+ is already used\.|That sales order is already \w+\./;

/**
 * The sentence to show on the form. Postgres and PostgREST wrap the
 * database exception in extra text. The known sentence is pulled back out.
 */
export function salesOrderErrorMessage(error: unknown): string {
  const textValue = errorText(error);
  if (/schema cache|does not exist|Could not find/i.test(textValue) && /sales_order|so_|customers/i.test(textValue)) {
    return MIGRATION;
  }
  const match = textValue.match(KNOWN_SALES_ERROR);
  if (match) return match[0];
  if (textValue.includes("so_lines_text_check")) return "Enter a part number or a description.";
  if (textValue.includes("so_customer_notes_counter_check")) return "Enter the counter text.";
  if (textValue.includes("so_line_allocations_item_id_fkey")) return "Choose a SKU from the suggestions.";
  return textValue;
}

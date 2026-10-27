import type { CustomerDocumentKind } from "@/lib/customerDocument";

export type OrderTermsSection = {
  heading: string;
  body: string;
};

/**
 * Draft terms printed as the second page of an order confirmation.
 * Replace `draftLabel`, `seller`, and `sections` when final copy arrives.
 * The print layout reads only this file.
 */
export const ORDER_CONFIRMATION_TERMS: {
  draftLabel: string;
  title: string;
  seller: string;
  sections: OrderTermsSection[];
} = {
  draftLabel: "DRAFT FOR REVIEW — not final legal copy",
  title: "Terms and Conditions",
  seller: 'Deep Discount Servers LLC, 3730 E Dale Ave, Henderson, NV 89044 ("DDS")',
  sections: [
    {
      heading: "Acceptance of order",
      body: "This confirmation is DDS’s offer to sell the goods on page 1. The order is accepted when the buyer pays the amount due, or when DDS ships the goods, whichever is first. The buyer’s form does not add terms. DDS rejects any term that conflicts with this page. A change to quantity, price, or ship-to is not part of the order until DDS confirms it in writing.",
    },
    {
      heading: "Pricing and taxes",
      body: "Prices are in the currency on the confirmation and cover only the goods listed. They do not include sales tax, use tax, VAT, duties, or other government charges unless a line says they do. The buyer pays those charges. A price quoted in error is not binding. DDS may correct an obvious pricing error before shipment.",
    },
    {
      heading: "Payment",
      body: "Payment is due on the payment term printed on the confirmation. If none is printed, payment is due before shipment. DDS may hold the goods until it has cleared funds. A past-due amount accrues interest at the lesser of 1.5% per month or the highest rate Nevada law allows, plus reasonable collection costs. The buyer may not withhold or set off an amount DDS disputes.",
    },
    {
      heading: "Title and risk of loss",
      body: "Title passes to the buyer when DDS receives payment in full. Risk of loss passes when DDS delivers the goods to the carrier, including a carrier the buyer chose.",
    },
    {
      heading: "Shipping and FOB",
      body: "Shipment follows the Incoterms and ship method on the confirmation. If none are stated, the shipment is FOB Henderson, Nevada, DDS’s dock. Freight, insurance, and carrier charges are the buyer’s unless the confirmation says DDS pays them. Dates are estimates. DDS is not liable for a carrier delay.",
    },
    {
      heading: "Inspection and returns",
      body: "The buyer must inspect the goods within five business days after delivery and must write to DDS in that time about any shortage, damage, or mismatch. A claim not made in time is waived, except a hidden defect a careful inspection would not have found. A return needs an RMA number from DDS before the goods are sent back. Goods returned without an RMA may be refused. Returned goods must be in the condition received. DDS may charge a restocking fee when the return is not a DDS error. The buyer pays return freight unless DDS agrees otherwise.",
    },
    {
      heading: "Refurbished and as-is goods",
      body: "Unless the confirmation says an item is new, the goods may be refurbished, used, pulled, or sold as-is. Those goods are sold as-is, including the wear and prior use a pulled part can have. A description is a guide. It is not a promise that the goods are new or unused.",
    },
    {
      heading: "Warranty",
      body: "DDS warrants that it has title to the goods and that the goods match the SKU and quantity on the confirmation. Except for that, and except for a warranty Nevada law does not allow DDS to disclaim, DDS disclaims all warranties, express or implied, including merchantability and fitness for a particular purpose. Any remedy DDS gives is limited, at DDS’s choice, to repair, replacement, or a refund of the price paid for the nonconforming goods. That is the buyer’s exclusive remedy.",
    },
    {
      heading: "Limitation of liability",
      body: "To the extent Nevada law allows, DDS is not liable for indirect, incidental, special, consequential, or punitive damages, or for lost profits, lost data, or cover, even if advised of the possibility. DDS’s total liability for a claim about an order will not exceed the price the buyer paid DDS for the goods that claim is about.",
    },
    {
      heading: "Export",
      body: "The buyer will comply with U.S. export laws, including the Export Administration Regulations and sanctions administered by OFAC. The buyer will not export, re-export, or transfer the goods to a prohibited destination, end user, or end use. The buyer is the exporter of record when the goods leave the United States, unless the confirmation says DDS is.",
    },
    {
      heading: "Force majeure",
      body: "DDS is not liable for a delay or failure caused by an event beyond its reasonable control, including a carrier or supplier failure, fire, flood, labor dispute, government action, or shortage of goods. DDS may allocate available goods as it considers fair and may cancel the unfilled balance without liability.",
    },
    {
      heading: "No assignment",
      body: "The buyer may not assign this order or these terms without DDS’s written consent. DDS may assign them to a successor of the business.",
    },
    {
      heading: "Entire agreement",
      body: "The confirmation and this page are the whole agreement about this order. They replace prior quotes, emails, and talks about the same goods. A change must be in writing and confirmed by DDS. If this page conflicts with the confirmation, the confirmation controls price, quantity, and ship-to, and this page controls the rest.",
    },
    {
      heading: "Nevada law and venue",
      body: "These terms are governed by the laws of the State of Nevada, without its conflict-of-law rules. The state and federal courts in Clark County, Nevada are the exclusive venue, and each party consents to that venue. The UN Convention on Contracts for the International Sale of Goods does not apply.",
    },
  ],
};

export function orderConfirmationShowsTerms(kind: CustomerDocumentKind): boolean {
  return kind === "confirmation";
}

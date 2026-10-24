import { ItemEbayListings } from "@/components/ItemEbayListings";
import { ItemForm } from "@/components/ItemForm";
import { ItemPricingPanel } from "@/components/ItemPricingPanel";

export const dynamic = "force-dynamic";

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <ItemForm mode="edit" itemId={id} />
      {id ? <ItemEbayListings itemId={id} /> : null}
      {id ? <ItemPricingPanel itemId={id} /> : null}
    </>
  );
}

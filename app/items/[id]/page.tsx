import { ItemEbayListings } from "@/components/ItemEbayListings";
import { ItemForm } from "@/components/ItemForm";
import { ItemPricingPanel } from "@/components/ItemPricingPanel";
import { actorCan } from "@/lib/actorAccess";

export const dynamic = "force-dynamic";

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const showPrices = await actorCan("can_view_financials");
  return (
    <>
      <ItemForm mode="edit" itemId={id} />
      {id ? <ItemEbayListings itemId={id} /> : null}
      {showPrices && id ? <ItemPricingPanel itemId={id} /> : null}
    </>
  );
}

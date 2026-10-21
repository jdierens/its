import { ItemForm } from "@/components/ItemForm";

export default async function NewItemPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const params = await searchParams;
  const sourceId = params.from?.trim() || undefined;
  return <ItemForm mode="create" sourceId={sourceId} />;
}

"use client";

import { useParams } from "next/navigation";
import { ItemForm } from "@/components/ItemForm";

export default function EditItemPage() {
  const params = useParams<{ id: string }>();
  const itemId = Array.isArray(params.id) ? params.id[0] : params.id;
  return <ItemForm mode="edit" itemId={itemId} />;
}

"use client";

import { useParams } from "next/navigation";
import { TaxonomyFields } from "@/components/TaxonomyFields";

export default function TaxonomyFieldsPage() {
  const params = useParams<{ id: string }>();
  const taxonomyId = Array.isArray(params.id) ? params.id[0] : params.id;
  return <TaxonomyFields taxonomyId={taxonomyId} />;
}

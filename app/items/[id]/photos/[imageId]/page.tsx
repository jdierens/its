"use client";

import { useParams } from "next/navigation";
import { PhotoEditor } from "@/components/PhotoEditor";

export default function PhotoEditorPage() {
  const params = useParams<{ id: string; imageId: string }>();
  const itemId = Array.isArray(params.id) ? params.id[0] : params.id;
  const imageId = Array.isArray(params.imageId) ? params.imageId[0] : params.imageId;
  return <PhotoEditor itemId={itemId} imageId={imageId} />;
}

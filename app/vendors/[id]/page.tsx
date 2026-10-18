"use client";

import { useParams } from "next/navigation";
import { ContactForm } from "@/components/ContactForm";

export default function EditVendorPage() {
  const params = useParams<{ id: string }>();
  const contactId = Array.isArray(params.id) ? params.id[0] : params.id;
  return <ContactForm kind="vendor" mode="edit" contactId={contactId} />;
}

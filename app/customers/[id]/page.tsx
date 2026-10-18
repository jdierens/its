"use client";

import { useParams } from "next/navigation";
import { ContactForm } from "@/components/ContactForm";

export default function EditCustomerPage() {
  const params = useParams<{ id: string }>();
  const contactId = Array.isArray(params.id) ? params.id[0] : params.id;
  return <ContactForm kind="customer" mode="edit" contactId={contactId} />;
}

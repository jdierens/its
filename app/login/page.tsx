import { LoginPage } from "@/components/LoginPage";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  return <LoginPage error={params.error ?? null} next={params.next ?? null} />;
}

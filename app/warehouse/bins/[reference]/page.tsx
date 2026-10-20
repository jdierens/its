import { BinView } from "@/components/BinView";

export default async function BinRoute({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  return <BinView reference={decodeURIComponent(reference)} />;
}

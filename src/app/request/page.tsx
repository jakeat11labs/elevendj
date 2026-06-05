import { RequestLine } from "@/app/request/request-line";

export const dynamic = "force-dynamic";

export default async function RequestPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  return <RequestLine code={code ?? null} />;
}

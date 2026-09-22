import { redirect } from 'next/navigation';
export default async function Page({
  params,
}: {
  params: Promise<{ token: string; id: string }>;
}) {
  const { token, id } = await params;
  redirect(`/q/${token}/order/${id}`);
}

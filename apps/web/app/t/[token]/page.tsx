import { redirect } from 'next/navigation';
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  redirect(`/q/${token}`);
}

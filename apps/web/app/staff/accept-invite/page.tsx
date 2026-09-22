import { AcceptInvitation } from '../../../components/account-links';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <AcceptInvitation token={token || ''} />;
}

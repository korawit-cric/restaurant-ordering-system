import { ResetPassword } from '../../../components/account-links';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <ResetPassword token={token || ''} />;
}

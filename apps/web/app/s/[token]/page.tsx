import { CustomerMenu } from '../../../components/customer-menu';
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <CustomerMenu kind="s" token={token} />;
}

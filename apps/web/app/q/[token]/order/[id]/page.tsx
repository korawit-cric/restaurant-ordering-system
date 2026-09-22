import { CustomerOrder } from '../../../../../components/customer-order';
export default async function Page({
  params,
}: {
  params: Promise<{ token: string; id: string }>;
}) {
  return <CustomerOrder kind="q" {...await params} />;
}

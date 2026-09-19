import { StaffOrders } from '../../../../components/staff-orders';
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <StaffOrders id={(await params).id} />;
}

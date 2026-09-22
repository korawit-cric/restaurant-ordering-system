export type OrderStatus =
  | 'NEW'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY'
  | 'COMPLETED'
  | 'CANCELLED';
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED';
export type PaymentMethod = 'CASH' | 'PROMPTPAY';
export type Preset =
  | 'TABLE_SERVICE'
  | 'BAR_FLEXIBLE'
  | 'QUICK_SERVICE'
  | 'PICKUP_STALL';
export interface User {
  id: string;
  email: string;
  platformRole: 'USER' | 'OPERATOR';
  tenantId: string | null;
  branchId: string | null;
  role: 'OWNER' | 'MANAGER' | 'STAFF' | null;
  memberships: {
    tenantId: string;
    tenantName: string;
    branchId: string;
    branchName: string;
    role: string;
  }[];
}
export interface Category {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
  products: Product[];
}
export interface Product {
  id: string;
  categoryId: string;
  name: string;
  price: string;
  description: string | null;
  imageUrl: string | null;
  active: boolean;
  available: boolean;
  sortOrder: number;
}
export interface ServicePoint {
  id: string;
  name: string;
  description: string | null;
  type: string;
  qrToken: string;
  active: boolean;
}
export interface OrderSession {
  id: string;
  servicePointId: string | null;
  label: string | null;
  description: string | null;
  token: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  subtotal: string;
  paymentMethod: PaymentMethod | null;
  paymentStatus: PaymentStatus;
  _count?: { orders: number };
  servicePoint?: ServicePoint | null;
}
export interface BranchSettings {
  preset: string;
  qrMode: 'PERMANENT' | 'SESSION';
  sessionMode: 'SINGLE_ORDER' | 'OPEN_SESSION';
  paymentMode: 'PER_ORDER' | 'AT_CHECKOUT' | 'STAFF_MANAGED';
  fulfillmentMode: 'SERVE_TO_LOCATION' | 'PICKUP';
  promptpayId: string | null;
}
export interface Branch {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  status: string;
  settings: BranchSettings;
  tenant: {
    id: string;
    name: string;
    subscription: {
      status: string;
      plan: { name: string; branchLimit: number };
    };
  };
}
export interface Menu {
  branch: { id: string; name: string };
  servicePoint: { id: string; name: string; description: string | null } | null;
  session: {
    id: string;
    label: string | null;
    description: string | null;
    status: string;
  } | null;
  settings: BranchSettings;
  categories: Category[];
}
export interface OrderItem {
  id: string;
  productId: string | null;
  productNameSnapshot: string;
  unitPriceSnapshot: string;
  quantity: number;
  note: string | null;
  lineTotal: string;
}
export interface Order {
  id: string;
  tenantId: string;
  branchId: string;
  sessionId: string | null;
  servicePointId: string | null;
  locationSnapshot: string | null;
  orderNumber: number;
  status: OrderStatus;
  paymentMethod: PaymentMethod | null;
  paymentStatus: PaymentStatus;
  total: string;
  subtotal: string;
  paidAt: string | null;
  createdAt: string;
  items: OrderItem[];
  session?: {
    id: string;
    label: string | null;
    description: string | null;
    status: string;
  } | null;
  servicePoint?: { id: string; name: string; type: string } | null;
}
export interface CreateOrder {
  requestKey: string;
  method: PaymentMethod | null;
  items: {
    productId: string;
    quantity: number;
    expectedPrice: string;
    note?: string | null;
  }[];
}
export interface OrderPage {
  orders: Order[];
  nextCursor: string | null;
}
export interface Summary {
  date: string;
  orderCount: number;
  cash: string;
  promptpay: string;
  total: string;
  topProducts: {
    productId: string | null;
    productNameSnapshot: string;
    _sum: { quantity: number | null };
  }[];
}
export interface ApiEndpoint<TResponse = unknown> {
  url: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  _response?: TResponse;
}
export interface ApiEndpointWithBody<
  TBody = unknown,
  TResponse = unknown,
> extends ApiEndpoint<TResponse> {
  body?: TBody;
}

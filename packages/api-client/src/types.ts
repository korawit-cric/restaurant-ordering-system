export type OrderStatus =
  | 'NEW'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'SERVED'
  | 'CANCELLED';
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED';
export type PaymentMethod = 'CASH' | 'QR';
export interface User {
  id: string;
  email: string;
  role: 'ADMIN' | 'STAFF';
}
export interface Category {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
}
export interface MenuItem {
  id: string;
  name: string;
  categoryId: string;
  price: string;
  description: string | null;
  imageUrl: string | null;
  active: boolean;
  available: boolean;
  sortOrder: number;
}
export interface Table {
  id: string;
  name: string;
  qrToken: string;
  active: boolean;
}
export interface Menu {
  table: { id: string; name: string };
  categories: (Category & { items: MenuItem[] })[];
  payment: { qrUrl: string | null; recipient: string | null };
}
export interface Order {
  id: string;
  orderNumber: number;
  tableId: string;
  tableName: string;
  status: OrderStatus;
  total: string;
  createdAt: string;
  items: {
    id: string;
    menuItemId: string;
    name: string;
    quantity: number;
    unitPrice: string;
    lineTotal: string;
  }[];
  payment: {
    method: PaymentMethod;
    status: PaymentStatus;
    amount: string;
    paidAt: string | null;
  } | null;
}
export interface CreateOrder {
  requestKey: string;
  method: PaymentMethod;
  items: { menuItemId: string; quantity: number; expectedPrice: string }[];
}
export interface OrderPage {
  orders: Order[];
  nextCursor: string | null;
}
export interface Summary {
  date: string;
  orderCount: number;
  cash: string;
  qr: string;
  total: string;
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

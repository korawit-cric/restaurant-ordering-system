import type {
  ApiEndpointWithBody,
  Menu,
  Order,
  CreateOrder,
  OrderPage,
  OrderStatus,
  Summary,
  User,
  Category,
  MenuItem,
  Table,
} from './types.js';
function endpoint<T>(
  url: string,
  method: ApiEndpointWithBody['method'] = 'GET',
  body?: unknown,
): ApiEndpointWithBody<unknown, T> {
  return { url, method, body };
}
export const orderingApi = {
  menu: (token: string) =>
    endpoint<Menu>(`/public/tables/${encodeURIComponent(token)}/menu`),
  create: (token: string, body: CreateOrder) =>
    endpoint<Order>(
      `/public/tables/${encodeURIComponent(token)}/orders`,
      'POST',
      body,
    ),
  order: (token: string, id: string) =>
    endpoint<Order>(`/public/tables/${encodeURIComponent(token)}/orders/${id}`),
  me: () => endpoint<User>('/auth/me'),
  login: (email: string, password: string) =>
    endpoint<User>('/auth/login', 'POST', { email, password }),
  logout: () => endpoint('/auth/logout', 'POST', {}),
  orders: (history = false, cursor?: string) =>
    endpoint<OrderPage>(
      `/staff/orders?history=${history}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),
  detail: (id: string) => endpoint<Order>(`/staff/orders/${id}`),
  status: (id: string, status: OrderStatus) =>
    endpoint<Order>(`/staff/orders/${id}/status`, 'PATCH', { status }),
  confirm: (id: string) => endpoint(`/staff/orders/${id}/payment`, 'POST', {}),
  summary: () => endpoint<Summary>('/staff/summary'),
  categories: () => endpoint<Category[]>('/admin/categories'),
  items: () => endpoint<MenuItem[]>('/admin/menu'),
  tables: () => endpoint<Table[]>('/admin/tables'),
  save: (kind: 'categories' | 'menu' | 'tables', body: unknown, id?: string) =>
    endpoint(
      `/admin/${kind}${id ? `/${id}` : ''}`,
      id ? 'PATCH' : 'POST',
      body,
    ),
  rotate: (id: string) => endpoint(`/admin/tables/${id}/token`, 'POST', {}),
};

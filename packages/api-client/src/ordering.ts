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
  Product,
  ServicePoint,
  OrderSession,
  Branch,
  BranchSettings,
  Preset,
} from './types.js';
function endpoint<T>(
  url: string,
  method: ApiEndpointWithBody['method'] = 'GET',
  body?: unknown,
): ApiEndpointWithBody<unknown, T> {
  return { url, method, body };
}
const pub = (kind: 'q' | 's', token: string) =>
  `/public/${kind}/${encodeURIComponent(token)}`;
export const orderingApi = {
  menu: (kind: 'q' | 's', token: string) =>
    endpoint<Menu>(`${pub(kind, token)}/menu`),
  create: (kind: 'q' | 's', token: string, body: CreateOrder) =>
    endpoint<Order>(`${pub(kind, token)}/orders`, 'POST', body),
  order: (kind: 'q' | 's', token: string, id: string) =>
    endpoint<Order>(`${pub(kind, token)}/orders/${id}`),
  orderPromptpay: (kind: 'q' | 's', token: string, id: string) =>
    endpoint<{ svg: string; amount: string; manualConfirmation: true }>(
      `${pub(kind, token)}/orders/${id}/promptpay`,
    ),
  signup: (body: unknown) => endpoint<User>('/auth/signup', 'POST', body),
  login: (email: string, password: string) =>
    endpoint<User>('/auth/login', 'POST', { email, password }),
  requestPasswordReset: (email: string) =>
    endpoint<{ message: string }>('/auth/password/request', 'POST', { email }),
  resetPassword: (token: string, password: string) =>
    endpoint<{ ok: true }>('/auth/password/reset', 'POST', { token, password }),
  invitation: (token: string) =>
    endpoint<{
      email: string;
      role: 'MANAGER' | 'STAFF';
      restaurant: string;
      branch: string;
      needsPassword: boolean;
    }>(`/auth/invitations/${encodeURIComponent(token)}`),
  acceptInvitation: (token: string, password?: string) =>
    endpoint<{ ok: true }>(
      `/auth/invitations/${encodeURIComponent(token)}/accept`,
      'POST',
      password ? { password } : {},
    ),
  me: () => endpoint<User>('/auth/me'),
  logout: () => endpoint('/auth/logout', 'POST', {}),
  context: (branchId: string) =>
    endpoint('/auth/context', 'POST', { branchId }),
  branch: () => endpoint<Branch>('/restaurant/branch'),
  branches: () => endpoint<Branch[]>('/restaurant/branches'),
  newBranch: (body: unknown) =>
    endpoint<Branch>('/restaurant/branches', 'POST', body),
  settings: (body: Partial<BranchSettings>) =>
    endpoint<BranchSettings>('/restaurant/settings', 'PATCH', body),
  preset: (preset: Preset) =>
    endpoint<BranchSettings>('/restaurant/preset', 'POST', { preset }),
  onboarding: () =>
    endpoint<{ branch: Branch; steps: { key: string; done: boolean }[] }>(
      '/restaurant/onboarding',
    ),
  staff: () =>
    endpoint<{ id: string; email: string; role: string; active: boolean }[]>(
      '/restaurant/staff',
    ),
  addStaff: (body: unknown) => endpoint('/restaurant/staff', 'POST', body),
  invitations: () =>
    endpoint<{ id: string; email: string; role: string; expiresAt: string }[]>(
      '/restaurant/invitations',
    ),
  sendInvitation: (email: string, role: 'MANAGER' | 'STAFF') =>
    endpoint('/restaurant/invitations', 'POST', { email, role }),
  revokeInvitation: (id: string) =>
    endpoint(`/restaurant/invitations/${id}`, 'DELETE', {}),
  updateStaff: (id: string, body: unknown) =>
    endpoint(`/restaurant/staff/${id}`, 'PATCH', body),
  points: () => endpoint<ServicePoint[]>('/restaurant/service-points'),
  savePoint: (body: unknown, id?: string) =>
    endpoint<ServicePoint>(
      `/restaurant/service-points${id ? `/${id}` : ''}`,
      id ? 'PATCH' : 'POST',
      body,
    ),
  rotate: (id: string) =>
    endpoint<ServicePoint>(
      `/restaurant/service-points/${id}/rotate`,
      'POST',
      {},
    ),
  sessions: () => endpoint<OrderSession[]>('/restaurant/sessions'),
  openSession: (body: unknown) =>
    endpoint<OrderSession>('/restaurant/sessions', 'POST', body),
  updateSession: (id: string, body: unknown) =>
    endpoint<OrderSession>(`/restaurant/sessions/${id}`, 'PATCH', body),
  closeSession: (id: string, method?: 'CASH' | 'PROMPTPAY') =>
    endpoint<OrderSession>(`/restaurant/sessions/${id}/close`, 'POST', {
      method: method || null,
    }),
  confirmSession: (id: string) =>
    endpoint<OrderSession>(`/restaurant/sessions/${id}/payment`, 'POST', {}),
  sessionPromptpay: (id: string) =>
    endpoint<{ svg: string; amount: string }>(
      `/staff/sessions/${id}/promptpay`,
    ),
  orders: (history = false, cursor?: string) =>
    endpoint<OrderPage>(
      `/staff/orders?history=${history}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),
  detail: (id: string) => endpoint<Order>(`/staff/orders/${id}`),
  status: (id: string, status: OrderStatus) =>
    endpoint<Order>(`/staff/orders/${id}/status`, 'PATCH', { status }),
  confirm: (id: string) =>
    endpoint<Order>(`/staff/orders/${id}/payment`, 'POST', {}),
  summary: () => endpoint<Summary>('/staff/summary'),
  daily: (days = 7) =>
    endpoint<
      { date: string; cash: string; promptpay: string; total: string }[]
    >(`/staff/daily?days=${days}`),
  categories: () => endpoint<Category[]>('/admin/categories'),
  saveCategory: (body: unknown, id?: string) =>
    endpoint<Category>(
      `/admin/categories${id ? `/${id}` : ''}`,
      id ? 'PATCH' : 'POST',
      body,
    ),
  products: () => endpoint<Product[]>('/admin/products'),
  saveProduct: (body: unknown, id?: string) =>
    endpoint<Product>(
      `/admin/products${id ? `/${id}` : ''}`,
      id ? 'PATCH' : 'POST',
      body,
    ),
  availability: (id: string, available: boolean) =>
    endpoint<Product>(`/admin/products/${id}/availability`, 'PATCH', {
      available,
    }),
  platformTenants: () => endpoint<unknown[]>('/platform/tenants'),
};

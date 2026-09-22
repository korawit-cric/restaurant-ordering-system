'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { orderingApi } from '@repo/api-client';
import { ApiError, clientFetch } from '../lib/fetch/client';
import { ErrorNotice } from './shared';
export function StaffShell({
  children,
  admin = false,
}: {
  children: React.ReactNode;
  admin?: boolean;
}) {
  const router = useRouter(),
    path = usePathname(),
    cache = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => clientFetch(orderingApi.me()),
    retry: false,
    refetchInterval: 60000,
  });
  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401)
      router.replace('/staff/login');
  }, [me.error, router]);
  if (!me.data)
    return (
      <main className="workspace">
        <p>Checking access…</p>
        <ErrorNotice error={me.error} />
        <Link href="/staff/login">Sign in</Link>
      </main>
    );
  if (admin && !['OWNER', 'MANAGER'].includes(me.data.role || ''))
    return (
      <main className="workspace">
        <h1>Manager access required</h1>
        <Link href="/staff/orders">Back to orders</Link>
      </main>
    );
  const links = [
    ['/staff/orders', 'Live orders'],
    ['/staff/sessions', 'Sessions'],
    ['/staff/history', 'History'],
    ['/staff/reports', 'Reports'],
    ...(me.data.role !== 'STAFF'
      ? [
          ['/admin/menu', 'Menu'],
          ['/admin/categories', 'Categories'],
          ['/admin/service-points', 'QR locations'],
          ['/admin/settings', 'Settings'],
          ['/admin/onboarding', 'Setup'],
          ['/admin/branches', 'Branches'],
          ['/admin/staff', 'Staff'],
        ]
      : []),
  ];
  return (
    <div className="staff-app">
      <aside>
        <Link href="/staff/orders" className="wordmark">
          <span className="brand-icon">↗</span> ORDERLY
        </Link>
        <div className="eyebrow">
          {me.data.memberships.find((m) => m.branchId === me.data?.branchId)
            ?.branchName || 'SERVICE'}
        </div>
        <nav>
          {links.map(([href, label]) => (
            <Link
              key={href}
              href={href!}
              className={path === href ? 'current' : ''}
            >
              {label}
            </Link>
          ))}
          {me.data.platformRole === 'OPERATOR' && (
            <Link href="/platform">Platform</Link>
          )}
        </nav>
        <div className="staff-user">
          <select
            aria-label="Active branch"
            value={me.data.branchId || ''}
            onChange={(e) => {
              const branchId = e.target.value;
              void clientFetch(orderingApi.context(branchId)).then(() => {
                cache.clear();
                window.location.href = '/staff/orders';
              });
            }}
          >
            {me.data.memberships.map((m) => (
              <option key={m.branchId} value={m.branchId}>
                {m.tenantName} · {m.branchName}
              </option>
            ))}
          </select>
          <span>{me.data.email}</span>
          <small>{me.data.role}</small>
          <button
            onClick={() =>
              void clientFetch(orderingApi.logout()).then(() => {
                window.location.href = '/staff/login';
              })
            }
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="workspace">{children}</main>
    </div>
  );
}

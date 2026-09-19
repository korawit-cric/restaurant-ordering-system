'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
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
  const router = useRouter();
  const path = usePathname();
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
        <p>Checking staff access…</p>
        <ErrorNotice error={me.error} />
        <Link href="/staff/login">Sign in</Link>
      </main>
    );
  if (admin && me.data.role !== 'ADMIN')
    return (
      <main className="workspace">
        <h1>Admin access required</h1>
        <Link href="/staff/orders">Back to orders</Link>
      </main>
    );
  const links = [
    ['/staff/orders', 'Live orders'],
    ['/staff/history', 'History'],
    ...(me.data.role === 'ADMIN'
      ? [
          ['/admin/menu', 'Menu'],
          ['/admin/categories', 'Categories'],
          ['/admin/tables', 'Tables'],
        ]
      : []),
  ];
  return (
    <div className="staff-app">
      <aside>
        <Link href="/staff/orders" className="wordmark">
          <span className="brand-icon">↗</span> ORDERING / POC
        </Link>
        <div className="eyebrow">SERVICE STATION</div>
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
        </nav>
        <div className="staff-user">
          <span>{me.data.email}</span>
          <small>{me.data.role}</small>
          <button
            onClick={() => {
              void clientFetch(orderingApi.logout()).then(() => {
                window.location.href = '/staff/login';
              });
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="workspace">{children}</main>
    </div>
  );
}

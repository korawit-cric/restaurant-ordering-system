'use client';
import { useQuery } from '@tanstack/react-query';
import { orderingApi } from '@repo/api-client';
import { clientFetch } from '../../lib/fetch/client';
import { StaffShell } from '../../components/staff-shell';
import { ErrorNotice } from '../../components/shared';
export default function Platform() {
  const q = useQuery({
    queryKey: ['platform-tenants'],
    queryFn: () => clientFetch(orderingApi.platformTenants()),
  });
  return (
    <StaffShell>
      <h1>Platform tenants</h1>
      <p>
        Subscription and branch overview. Restaurant order data stays in its
        branch workspace.
      </p>
      <ErrorNotice error={q.error} />
      <div className="panel management-list">
        {q.data?.map((raw, i) => {
          const t = raw as {
            id: string;
            name: string;
            slug: string;
            status: string;
            _count: { branches: number };
            subscription?: { status: string; plan: { name: string } };
          };
          return (
            <div className="management-row" key={t.id || i}>
              <strong className="management-name">
                {t.name}
                <small>{t.slug}</small>
              </strong>
              <span>{t._count.branches} branches</span>
              <span>{t.subscription?.plan.name}</span>
              <span>{t.subscription?.status}</span>
            </div>
          );
        })}
      </div>
    </StaffShell>
  );
}

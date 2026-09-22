'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { orderingApi } from '@repo/api-client';
import { clientFetch } from '../lib/fetch/client';
import { ErrorNotice, money, Status } from './shared';
export function CustomerOrder({
  kind,
  token,
  id,
}: {
  kind: 'q' | 's';
  token: string;
  id: string;
}) {
  const query = useQuery({
    queryKey: ['order', kind, token, id],
    queryFn: () => clientFetch(orderingApi.order(kind, token, id)),
    refetchInterval: 5000,
  });
  const o = query.data;
  const pay = useQuery({
    queryKey: ['payment', id],
    queryFn: () => clientFetch(orderingApi.orderPromptpay(kind, token, id)),
    enabled:
      !!o && o.paymentMethod === 'PROMPTPAY' && o.paymentStatus === 'PENDING',
    retry: false,
  });
  return (
    <main className="customer confirmation">
      <div className="wordmark">ORDERLY</div>
      <ErrorNotice error={query.error} />
      {!o ? (
        <p>Loading order…</p>
      ) : (
        <>
          <div className="success-mark">✓</div>
          <div className="eyebrow">
            {o.locationSnapshot || 'PICKUP'} · ORDER #{o.orderNumber}
          </div>
          <h1>Order received.</h1>
          <p>Staff can see your order. Check here for updates.</p>
          <div className="status-line">
            <Status value={o.status} />
            <Status value={o.paymentStatus} />
          </div>
          <section className="panel">
            {o.items.map((i) => (
              <div className="checkout-row" key={i.id}>
                <div>
                  <strong>
                    {i.quantity} × {i.productNameSnapshot}
                  </strong>
                  {i.note && <small>{i.note}</small>}
                </div>
                <span>{money(i.lineTotal)}</span>
              </div>
            ))}
            <div className="total">
              <span>{o.paymentMethod || 'Pay at checkout'}</span>
              <strong>{money(o.total)}</strong>
            </div>
          </section>
          {o.paymentStatus === 'PENDING' && o.paymentMethod === 'PROMPTPAY' && (
            <section className="panel">
              <h2>Pay {money(o.total)} with PromptPay</h2>
              {pay.data && (
                <img
                  className="payment-qr"
                  src={`data:image/svg+xml,${encodeURIComponent(pay.data.svg)}`}
                  alt="PromptPay QR"
                />
              )}
              <p>
                Check the recipient in your banking app. Staff confirms payment
                manually.
              </p>
            </section>
          )}
          {o.paymentStatus === 'PENDING' && o.paymentMethod === 'CASH' && (
            <div className="notice">Pay staff {money(o.total)} in cash.</div>
          )}
          <Link className="button primary" href={`/${kind}/${token}`}>
            Order again →
          </Link>
        </>
      )}
    </main>
  );
}

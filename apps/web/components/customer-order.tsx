'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { orderingApi } from '@repo/api-client';
import { clientFetch } from '../lib/fetch/client';
import { ErrorNotice, money, Status } from './shared';
export function CustomerOrder({ token, id }: { token: string; id: string }) {
  const query = useQuery({
    queryKey: ['order', id],
    queryFn: () => clientFetch(orderingApi.order(token, id)),
    refetchInterval: 5000,
    retry: 1,
  });
  const menu = useQuery({
    queryKey: ['menu', token],
    queryFn: () => clientFetch(orderingApi.menu(token)),
  });
  const order = query.data;
  return (
    <main className="customer confirmation">
      <div className="wordmark">ORDERING / POC</div>
      <ErrorNotice error={query.error} />
      {!order ? (
        <p>Loading order…</p>
      ) : (
        <>
          <div className="success-mark">✓</div>
          <div className="eyebrow">
            TABLE {order.tableName} · ORDER #{order.orderNumber}
          </div>
          <h1>Order received.</h1>
          <p>
            Your round is with the bar. You can check back here for updates.
          </p>
          <div className="status-line">
            <Status value={order.status} />
            <Status value={order.payment?.status || 'PENDING'} />
          </div>
          <section className="panel">
            {order.items.map((item) => (
              <div className="checkout-row" key={item.id}>
                <strong>
                  {item.quantity} × {item.name}
                </strong>
                <span>{money(item.lineTotal)}</span>
              </div>
            ))}
            <div className="total">
              <span>Total · {order.payment?.method}</span>
              <strong>{money(order.total)}</strong>
            </div>
          </section>
          {order.payment?.status === 'PENDING' &&
            (order.payment.method === 'QR' ? (
              <section className="panel">
                <h2>Pay {money(order.total)} by PromptPay</h2>
                {menu.data?.payment.qrUrl && (
                  <>
                    <img
                      className="payment-qr"
                      src={menu.data.payment.qrUrl}
                      alt="Restaurant PromptPay payment QR"
                    />
                    <a
                      href={menu.data.payment.qrUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open QR image to save
                    </a>
                  </>
                )}
                <p>{menu.data?.payment.recipient}</p>
                <p>
                  Transfer the exact total. Check the recipient in your banking
                  app. Staff will confirm receipt; this screen does not verify a
                  transfer automatically.
                </p>
              </section>
            ) : (
              <div className="notice">
                Cash payment pending. Please pay staff {money(order.total)}.
              </div>
            ))}
          <Link className="button primary" href={`/t/${token}`}>
            Order another round →
          </Link>
          <p className="muted">Your next order will have its own payment.</p>
        </>
      )}
    </main>
  );
}

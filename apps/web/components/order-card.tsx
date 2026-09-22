'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { orderingApi, type Order, type OrderStatus } from '@repo/api-client';
import { clientFetch } from '../lib/fetch/client';
import { Action, ErrorNotice, money, Status } from './shared';
const next: Partial<Record<OrderStatus, OrderStatus>> = {
  NEW: 'ACCEPTED',
  ACCEPTED: 'PREPARING',
  PREPARING: 'READY',
  READY: 'COMPLETED',
};
const labels: Partial<Record<OrderStatus, string>> = {
  NEW: 'Accept',
  ACCEPTED: 'Preparing',
  PREPARING: 'Ready',
  READY: 'Complete',
};
export function OrderCard({
  order,
  highlight = false,
}: {
  order: Order;
  highlight?: boolean;
}) {
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const active = !['COMPLETED', 'CANCELLED'].includes(order.status);
  async function update(action: 'payment' | OrderStatus) {
    if (
      action === 'CANCELLED' &&
      !confirm(`Cancel order #${order.orderNumber}?`)
    )
      return;
    if (
      action === 'payment' &&
      !confirm(
        order.paymentMethod === 'PROMPTPAY'
          ? 'Confirm transfer arrived in the restaurant account?'
          : 'Confirm full cash payment received?',
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await clientFetch(
        action === 'payment'
          ? orderingApi.confirm(order.id)
          : orderingApi.status(order.id, action),
      );
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['staff-orders'] }),
        cache.invalidateQueries({ queryKey: ['summary'] }),
      ]);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className={`order-card ${highlight ? 'fresh' : ''}`}>
      <div className="order-card-top">
        <div>
          <small>{order.servicePoint?.type || 'LOCATION'}</small>
          <Link href={`/staff/orders/${order.id}`}>
            <h2>{order.locationSnapshot || `#${order.orderNumber}`}</h2>
          </Link>
          {order.session?.description && <p>{order.session.description}</p>}
        </div>
        <div className="order-meta">
          <strong>#{order.orderNumber}</strong>
          <time>
            {new Date(order.createdAt).toLocaleTimeString('en-GB', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </time>
          <Status value={order.status} />
        </div>
      </div>
      <div className="order-lines">
        {order.items.map((i) => (
          <div key={i.id}>
            <span className="item-count">{i.quantity}</span>
            <span>
              {i.productNameSnapshot}
              {i.note && <small> · {i.note}</small>}
            </span>
            <small>{money(i.lineTotal)}</small>
          </div>
        ))}
      </div>
      <div className="order-total">
        <strong>{money(order.total)}</strong>
        <span>
          {order.paymentMethod || 'CHECKOUT'}{' '}
          <Status value={order.paymentStatus} />
        </span>
      </div>
      <ErrorNotice error={error} />
      <div className="order-actions">
        {order.paymentMethod &&
          order.paymentStatus === 'PENDING' &&
          order.status !== 'CANCELLED' && (
            <Action
              secondary
              disabled={busy}
              onClick={() => void update('payment')}
            >
              {order.paymentMethod === 'CASH'
                ? 'Cash received'
                : 'Confirm PromptPay'}
            </Action>
          )}
        {active && (
          <Action
            disabled={busy}
            onClick={() => void update(next[order.status]!)}
          >
            {labels[order.status]} →
          </Action>
        )}
        {active && order.paymentStatus !== 'PAID' && (
          <button
            className="text-button danger"
            disabled={busy}
            onClick={() => void update('CANCELLED')}
          >
            Cancel order
          </button>
        )}
      </div>
    </article>
  );
}

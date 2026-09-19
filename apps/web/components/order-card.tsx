'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { orderingApi, type Order, type OrderStatus } from '@repo/api-client';
import { clientFetch } from '../lib/fetch/client';
import { Action, ErrorNotice, money, Status } from './shared';
const nextStatus: Partial<Record<OrderStatus, OrderStatus>> = {
  NEW: 'ACCEPTED',
  ACCEPTED: 'PREPARING',
  PREPARING: 'SERVED',
};
const labels: Partial<Record<OrderStatus, string>> = {
  NEW: 'Accept order',
  ACCEPTED: 'Start preparing',
  PREPARING: 'Mark served',
};
export function OrderCard({
  order,
  highlight = false,
}: {
  order: Order;
  highlight?: boolean;
}) {
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function update(action: 'payment' | OrderStatus) {
    if (
      action === 'CANCELLED' &&
      !window.confirm(
        `Cancel order #${order.orderNumber} for table ${order.tableName}? This cannot be undone.`,
      )
    )
      return;
    if (
      action === 'payment' &&
      !window.confirm(
        order.payment?.method === 'QR'
          ? 'Confirm that this exact transfer has arrived in the restaurant’s bank account?'
          : 'Confirm that you have collected the full cash amount?',
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
      await cache.invalidateQueries({ queryKey: ['staff-orders'] });
      await cache.invalidateQueries({ queryKey: ['summary'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const active = !['SERVED', 'CANCELLED'].includes(order.status);
  return (
    <article className={`order-card ${highlight ? 'fresh' : ''}`}>
      <div className="order-card-top">
        <div>
          <small>TABLE</small>
          <Link href={`/staff/orders/${order.id}`}>
            <h2>{order.tableName}</h2>
          </Link>
        </div>
        <div className="order-meta">
          <strong>#{order.orderNumber}</strong>
          <time>
            {new Date(order.createdAt).toLocaleTimeString('en-GB', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Asia/Bangkok',
            })}
          </time>
          <Status value={order.status} />
        </div>
      </div>
      <div className="order-lines">
        {order.items.map((item) => (
          <div key={item.id}>
            <span className="item-count">{item.quantity}</span>
            <span>{item.name}</span>
            <small>{money(item.lineTotal)}</small>
          </div>
        ))}
      </div>
      <div className="order-total">
        <strong>{money(order.total)}</strong>
        <span>
          {order.payment?.method}{' '}
          <Status value={order.payment?.status || 'PENDING'} />
        </span>
      </div>
      <ErrorNotice error={error} />
      <div className="order-actions">
        {order.payment?.status === 'PENDING' &&
          order.status !== 'CANCELLED' && (
            <Action
              secondary
              disabled={busy}
              onClick={() => void update('payment')}
            >
              {order.payment.method === 'CASH'
                ? 'Cash received'
                : 'Confirm QR receipt'}
            </Action>
          )}
        {active && (
          <Action
            disabled={busy}
            onClick={() => void update(nextStatus[order.status]!)}
          >
            {labels[order.status]} →
          </Action>
        )}
        {active && order.payment?.status !== 'PAID' && (
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

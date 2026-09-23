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
  detailed = false,
}: {
  order: Order;
  highlight?: boolean;
  detailed?: boolean;
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
    let paymentBody: { reference?: string; note?: string } = {};
    if (action === 'payment') {
      if (order.paymentMethod === 'PROMPTPAY') {
        const reference = prompt(
          'Check the receiving bank account, then enter its transaction reference:',
          '',
        );
        if (reference === null) return;
        if (reference.trim().length < 2) {
          setError(new Error('A bank transaction reference is required.'));
          return;
        }
        const note = prompt(
          'Optional verification note (bank, received time, or staff note):',
          '',
        );
        if (note === null) return;
        paymentBody = {
          reference: reference.trim(),
          ...(note.trim() ? { note: note.trim() } : {}),
        };
      } else if (!confirm('Confirm full cash payment received?')) return;
    }
    setBusy(true);
    setError(null);
    try {
      await clientFetch(
        action === 'payment'
          ? orderingApi.confirm(order.id, paymentBody)
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
  async function rejectClaim() {
    const reason = prompt('Why could this payment not be matched?');
    if (!reason?.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await clientFetch(
        orderingApi.rejectPaymentClaim(order.id, reason.trim()),
      );
      await cache.invalidateQueries({ queryKey: ['staff-orders'] });
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  async function createRefund() {
    const amount = prompt('Refund amount in THB:', order.total);
    if (!amount) return;
    const reason = prompt('Reason for refund:');
    if (!reason?.trim()) return;
    const bank = confirm(
      'Use bank transfer? Choose Cancel for a cash refund request.',
    );
    setBusy(true);
    setError(null);
    try {
      await clientFetch(
        orderingApi.createRefund(order.id, {
          amount: amount.trim(),
          method: bank ? 'BANK_TRANSFER' : 'CASH',
          reason: reason.trim(),
        }),
      );
      await cache.invalidateQueries({ queryKey: ['staff-orders'] });
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  async function updateRefund(
    refundId: string,
    method: 'CASH' | 'BANK_TRANSFER',
    action: 'complete' | 'cancel',
  ) {
    let reference: string | undefined;
    if (action === 'complete') {
      if (!confirm('Confirm the refund money has actually been returned?'))
        return;
      if (method === 'BANK_TRANSFER') {
        const value = prompt('Bank transfer reference:');
        if (!value?.trim()) return;
        reference = value.trim();
      }
    } else if (!confirm('Cancel this pending refund request?')) return;
    setBusy(true);
    setError(null);
    try {
      await clientFetch(
        action === 'complete'
          ? orderingApi.completeRefund(order.id, refundId, reference)
          : orderingApi.cancelRefund(order.id, refundId),
      );
      await cache.invalidateQueries({ queryKey: ['staff-orders'] });
      await cache.invalidateQueries({ queryKey: ['summary'] });
    } catch (error) {
      setError(error);
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
      {order.paymentMethod === 'PROMPTPAY' &&
        order.paymentStatus === 'PENDING' && (
          <div className="payment-review">
            {order.paymentClaim?.status === 'SUBMITTED' ? (
              <>
                <strong>Customer says payment was sent</strong>
                <small>
                  {order.paymentClaim.customerReference
                    ? `Customer reference: ${order.paymentClaim.customerReference}`
                    : 'No customer reference supplied'}
                </small>
                {order.paymentClaim.customerNote && (
                  <small>{order.paymentClaim.customerNote}</small>
                )}
                <button
                  className="text-button danger"
                  disabled={busy}
                  onClick={() => void rejectClaim()}
                >
                  Cannot match payment
                </button>
              </>
            ) : (
              <small>Waiting for the customer or a bank-account match.</small>
            )}
          </div>
        )}
      {order.paymentStatus === 'PAID' && order.paymentReference && (
        <div className="payment-review">
          <strong>Payment verified manually</strong>
          <small>Bank reference: {order.paymentReference}</small>
          {order.paymentNote && <small>{order.paymentNote}</small>}
        </div>
      )}
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
      {detailed && order.paymentStatus === 'PAID' && (
        <section className="refunds">
          <div className="refund-heading">
            <h3>Manual refunds</h3>
            <Action
              secondary
              disabled={busy}
              onClick={() => void createRefund()}
            >
              Request refund
            </Action>
          </div>
          {order.refunds?.length ? (
            order.refunds.map((refund) => (
              <div className="refund-row" key={refund.id}>
                <div>
                  <strong>{money(refund.amount)}</strong>{' '}
                  <Status value={refund.status} />
                  <small>
                    {refund.method.replace('_', ' ')} · {refund.reason}
                    {refund.reference ? ` · ${refund.reference}` : ''}
                  </small>
                </div>
                {refund.status === 'PENDING' && (
                  <div className="refund-actions">
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void updateRefund(refund.id, refund.method, 'complete')
                      }
                    >
                      Mark money returned
                    </button>
                    <button
                      className="text-button danger"
                      disabled={busy}
                      onClick={() =>
                        void updateRefund(refund.id, refund.method, 'cancel')
                      }
                    >
                      Cancel request
                    </button>
                  </div>
                )}
              </div>
            ))
          ) : (
            <small>No refunds recorded for this order.</small>
          )}
          <small>
            Owners and managers complete or cancel refund requests after
            returning the money outside Orderly.
          </small>
        </section>
      )}
    </article>
  );
}

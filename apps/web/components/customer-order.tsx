'use client';
import Link from 'next/link';
import { useState } from 'react';
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
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<unknown>(null);
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
  async function submitClaim() {
    setClaimBusy(true);
    setClaimError(null);
    try {
      await clientFetch(
        orderingApi.submitPaymentClaim(kind, token, id, {
          ...(reference.trim() ? { reference: reference.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      );
      await query.refetch();
    } catch (error) {
      setClaimError(error);
    } finally {
      setClaimBusy(false);
    }
  }
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
                Check the recipient and amount in your banking app. After
                paying, tell staff below. This does not mark the order paid
                until staff sees the deposit in the restaurant account.
              </p>
              {o.paymentClaim?.status === 'SUBMITTED' ? (
                <div className="notice">
                  Payment sent notice submitted. Staff is checking the bank
                  account.
                </div>
              ) : (
                <div className="payment-claim">
                  {o.paymentClaim?.status === 'REJECTED' && (
                    <div className="notice error">
                      Staff could not match the payment
                      {o.paymentClaim.reviewNote
                        ? `: ${o.paymentClaim.reviewNote}`
                        : '. Please check and submit again.'}
                    </div>
                  )}
                  <label>
                    Bank reference (optional)
                    <input
                      value={reference}
                      maxLength={100}
                      onChange={(event) => setReference(event.target.value)}
                      placeholder="Reference shown by your bank"
                    />
                  </label>
                  <label>
                    Note (optional)
                    <input
                      value={note}
                      maxLength={240}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Paying bank or transfer time"
                    />
                  </label>
                  <ErrorNotice error={claimError} />
                  <button
                    className="button primary"
                    type="button"
                    disabled={claimBusy}
                    onClick={() => void submitClaim()}
                  >
                    {claimBusy ? 'Submitting…' : 'I have paid'}
                  </button>
                </div>
              )}
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

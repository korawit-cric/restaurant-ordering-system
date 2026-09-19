'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  orderingApi,
  type CreateOrder,
  type PaymentMethod,
} from '@repo/api-client';
import { restoreCart, prepareOrder } from '../lib/cart';
import { ApiError, clientFetch } from '../lib/fetch/client';
import { Action, ErrorNotice, money } from './shared';
export function CustomerMenu({ token }: { token: string }) {
  const router = useRouter();
  const query = useQuery({
    queryKey: ['menu', token],
    queryFn: () => clientFetch(orderingApi.menu(token)),
    refetchInterval: 10000,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const [cart, setCart] = useState<Record<string, number>>({});
  const [checkout, setCheckout] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [pending, setPending] = useState<CreateOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [loaded, setLoaded] = useState(false);
  const storageKey = `ordering:${token}`;
  useEffect(() => {
    try {
      const saved = restoreCart(localStorage.getItem(storageKey));
      if (saved) {
        setCart(saved.cart || {});
        setPending(saved.pending || null);
        if (saved.pending) {
          setCheckout(true);
          setMethod(saved.pending.method);
        }
      }
    } catch {
      setError('Your saved cart could not be restored.');
    }
    setLoaded(true);
  }, [storageKey]);
  useEffect(() => {
    if (loaded) {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ cart, pending }));
      } catch {
        setError(
          'Browser storage is unavailable. Keep this page open until your order is confirmed.',
        );
      }
    }
  }, [cart, pending, loaded, storageKey]);
  const items = query.data?.categories.flatMap((c) => c.items) || [];
  const selected = Object.entries(cart)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => ({ item: items.find((i) => i.id === id), id, qty }));
  const total =
    selected.reduce(
      (sum, l) => sum + Math.round(Number(l.item?.price || 0) * 100) * l.qty,
      0,
    ) / 100;
  const count = selected.reduce((sum, l) => sum + l.qty, 0);
  const invalid = selected.some((l) => !l.item || !l.item.available);
  function change(id: string, delta: number) {
    if (pending || busy) return;
    setCart((c) => ({
      ...c,
      [id]: Math.min(30, Math.max(0, (c[id] || 0) + delta)),
    }));
  }
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const request =
        pending || prepareOrder(cart, items, method, crypto.randomUUID());
      // Persist the exact request before sending. Retries survive reload and reuse its key.
      localStorage.setItem(
        storageKey,
        JSON.stringify({ cart, pending: request }),
      );
      setPending(request);
      const order = await clientFetch(orderingApi.create(token, request));
      localStorage.removeItem(storageKey);
      setCart({});
      setPending(null);
      router.push(`/t/${token}/order/${order.id}`);
    } catch (e) {
      setError(e);
      if (e instanceof ApiError && [400, 404, 409].includes(e.status)) {
        setPending(null);
        await query.refetch();
      }
    } finally {
      setBusy(false);
    }
  }
  if (!query.data)
    return (
      <main className="customer">
        <div className="wordmark">ORDERING / POC</div>
        <ErrorNotice error={query.error} />
        <p>
          {query.isPending
            ? 'Opening your table…'
            : 'Unable to open this table.'}
        </p>
        <Action onClick={() => void query.refetch()}>Try again</Action>
      </main>
    );
  const { table, categories, payment } = query.data;
  return (
    <main className="customer">
      <header className="customer-header">
        <a href={`/t/${token}`} className="wordmark">
          ORDERING / POC
        </a>
        <span className="table-pill">TABLE {table.name}</span>
      </header>
      <div className="eyebrow">MAKE YOURSELF AT HOME</div>
      <h1>{checkout ? 'Your next round.' : 'What sounds good?'}</h1>
      <p className="muted">
        {checkout
          ? 'One order. One payment. Then enjoy.'
          : 'Drinks, a little food, and good company.'}
      </p>
      <ErrorNotice error={error || query.error} />
      {pending && (
        <div className="notice">
          An order is waiting for confirmation. Retry below to safely recover
          it. Your items are locked so a retry cannot place a different order.
        </div>
      )}
      {!checkout ? (
        <>
          <nav className="category-nav">
            {categories.map((c) => (
              <a key={c.id} href={`#${c.id}`}>
                {c.name}
              </a>
            ))}
          </nav>
          {categories.map((c) => (
            <section id={c.id} key={c.id}>
              <div className="section-title">
                <h2>{c.name}</h2>
                <span>{String(c.items.length).padStart(2, '0')}</span>
              </div>
              {c.items.map((item) => (
                <article
                  key={item.id}
                  className={`menu-row ${!item.available ? 'sold-out' : ''}`}
                >
                  {item.imageUrl && (
                    <img src={item.imageUrl} alt="" className="product-image" />
                  )}
                  <div className="item-copy">
                    <h3>{item.name}</h3>
                    {item.description && <p>{item.description}</p>}
                    <strong>{money(item.price)}</strong>
                  </div>
                  {!item.available ? (
                    <span className="badge">Sold out</span>
                  ) : (
                    <div className="quantity">
                      <button
                        aria-label={`Remove one ${item.name}`}
                        disabled={!!pending || busy || !cart[item.id]}
                        onClick={() => change(item.id, -1)}
                      >
                        −
                      </button>
                      <span>{cart[item.id] || 0}</span>
                      <button
                        aria-label={`Add one ${item.name}`}
                        disabled={
                          !!pending || busy || (cart[item.id] || 0) >= 30
                        }
                        onClick={() => change(item.id, 1)}
                      >
                        +
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </section>
          ))}
          <div className="cart-bar">
            <div>
              <strong>{count} items</strong>
              <span>{money(total)}</span>
            </div>
            <Action disabled={!count} onClick={() => setCheckout(true)}>
              View order →
            </Action>
          </div>
        </>
      ) : (
        <>
          <button className="text-button" onClick={() => setCheckout(false)}>
            ← Back to menu
          </button>
          <section className="panel">
            {selected.map((l) => (
              <div key={l.id} className="checkout-row">
                <div>
                  <strong>
                    {l.qty} × {l.item?.name || 'Unavailable item'}
                  </strong>
                  {(!l.item || !l.item.available) && (
                    <p className="danger">Remove this unavailable item</p>
                  )}
                </div>
                <span>{money(Number(l.item?.price || 0) * l.qty)}</span>
                <button
                  disabled={!!pending || busy}
                  aria-label={`Remove ${l.item?.name || 'item'}`}
                  onClick={() => setCart((c) => ({ ...c, [l.id]: 0 }))}
                >
                  ×
                </button>
              </div>
            ))}
            <div className="total">
              <span>Total</span>
              <strong>{money(total)}</strong>
            </div>
          </section>
          <h2>How would you like to pay?</h2>
          <div className="payment-options">
            {(['CASH', 'QR'] as const).map((m) => (
              <label key={m} className={method === m ? 'selected' : ''}>
                <input
                  type="radio"
                  name="payment"
                  checked={method === m}
                  disabled={!!pending || busy || (m === 'QR' && !payment.qrUrl)}
                  onChange={() => setMethod(m)}
                />
                <strong>{m === 'CASH' ? 'Cash' : 'PromptPay QR'}</strong>
                <small>
                  {m === 'CASH'
                    ? 'Pay at your table'
                    : payment.qrUrl
                      ? 'Staff confirms your transfer'
                      : 'Not configured yet'}
                </small>
              </label>
            ))}
          </div>
          <p className="muted">
            {method === 'QR'
              ? 'After placing your order, scan the payment QR and transfer the exact total. Staff will check receipt manually.'
              : 'Your order is sent straight to the bar. Staff will collect payment.'}
          </p>
          <Action
            disabled={busy || (!pending && (!count || invalid))}
            onClick={() => void submit()}
          >
            {busy
              ? 'Confirming…'
              : pending
                ? 'Retry this order safely'
                : `Place order · ${money(total)}`}
          </Action>
        </>
      )}
      <footer>TABLE {table.name} · EVERY ROUND IS A FRESH ORDER</footer>
    </main>
  );
}

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
export function CustomerMenu({
  kind,
  token,
}: {
  kind: 'q' | 's';
  token: string;
}) {
  const router = useRouter();
  const query = useQuery({
    queryKey: ['menu', kind, token],
    queryFn: () => clientFetch(orderingApi.menu(kind, token)),
    refetchInterval: 3000,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
    retry: 1,
  });
  const [cart, setCart] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [checkout, setCheckout] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [pending, setPending] = useState<CreateOrder | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const key = `order:${kind}:${token}`;
  useEffect(() => {
    try {
      const s = restoreCart(localStorage.getItem(key));
      if (s) {
        setCart(s.cart);
        setNotes(s.notes);
        setPending(s.pending);
        if (s.pending) setCheckout(true);
      }
    } catch {
      setError('Saved cart could not be restored.');
    }
    setLoaded(true);
  }, [key]);
  useEffect(() => {
    if (loaded) {
      try {
        localStorage.setItem(key, JSON.stringify({ cart, notes, pending }));
      } catch {
        setError('Keep this page open until the order is confirmed.');
      }
    }
  }, [cart, notes, pending, loaded, key]);
  const products = query.data?.categories.flatMap((c) => c.products) || [];
  const selected = Object.entries(cart)
    .filter(([, q]) => q > 0)
    .map(([id, quantity]) => ({
      product: products.find((p) => p.id === id),
      id,
      quantity,
    }));
  const count = selected.reduce((v, x) => v + x.quantity, 0);
  const total =
    selected.reduce(
      (v, x) =>
        v + Math.round(Number(x.product?.price || 0) * 100) * x.quantity,
      0,
    ) / 100;
  const invalid = selected.some((x) => !x.product || !x.product.available);
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
        pending ||
        prepareOrder(
          cart,
          notes,
          products,
          query.data?.settings.paymentMode === 'PER_ORDER' ? method : null,
          crypto.randomUUID(),
        );
      localStorage.setItem(
        key,
        JSON.stringify({ cart, notes, pending: request }),
      );
      setPending(request);
      const order = await clientFetch(orderingApi.create(kind, token, request));
      localStorage.removeItem(key);
      setPending(null);
      setCart({});
      setNotes({});
      router.push(`/${kind}/${token}/order/${order.id}`);
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
        <div className="wordmark">ORDERLY</div>
        <ErrorNotice error={query.error} />
        <p>
          {query.isPending
            ? 'Opening menu…'
            : 'This QR is not accepting orders.'}
        </p>
        <Action onClick={() => void query.refetch()}>Try again</Action>
      </main>
    );
  const { branch, servicePoint, session, categories, settings } = query.data;
  const location =
    session?.label ||
    servicePoint?.name ||
    (settings.fulfillmentMode === 'PICKUP' ? 'Pickup' : 'Your location');
  return (
    <main className="customer">
      <header className="customer-header">
        <a href={`/${kind}/${token}`} className="wordmark">
          ORDERLY
        </a>
        <span className="table-pill">{location}</span>
      </header>
      <div className="eyebrow">{branch.name.toUpperCase()}</div>
      <h1>{checkout ? 'Review your order' : 'What sounds good?'}</h1>
      <p className="muted">
        {session?.description ||
          servicePoint?.description ||
          'Order from your phone. Staff will take it from here.'}
      </p>
      <ErrorNotice error={error || query.error} />
      {pending && (
        <div className="notice">
          Your previous submission may have reached the restaurant. Retry it
          safely using the same request.
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
              </div>
              {c.products.map((p) => (
                <article
                  key={p.id}
                  className={`menu-row ${!p.available ? 'sold-out' : ''}`}
                >
                  {p.imageUrl && (
                    <img src={p.imageUrl} className="product-image" alt="" />
                  )}
                  <div className="item-copy">
                    <h3>{p.name}</h3>
                    {p.description && <p>{p.description}</p>}
                    <strong>{money(p.price)}</strong>
                  </div>
                  {p.available ? (
                    <div className="quantity">
                      <button
                        aria-label={`Remove one ${p.name}`}
                        disabled={!!pending || busy || !cart[p.id]}
                        onClick={() => change(p.id, -1)}
                      >
                        −
                      </button>
                      <span>{cart[p.id] || 0}</span>
                      <button
                        aria-label={`Add one ${p.name}`}
                        disabled={!!pending || busy || (cart[p.id] || 0) >= 30}
                        onClick={() => change(p.id, 1)}
                      >
                        +
                      </button>
                    </div>
                  ) : (
                    <span className="badge">Sold out</span>
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
            {selected.map((x) => (
              <div key={x.id}>
                <div className="checkout-row">
                  <strong>
                    {x.quantity} × {x.product?.name || 'Unavailable'}
                  </strong>
                  <span>
                    {money(Number(x.product?.price || 0) * x.quantity)}
                  </span>
                  <button
                    disabled={!!pending || busy}
                    aria-label="Remove item"
                    onClick={() => setCart((c) => ({ ...c, [x.id]: 0 }))}
                  >
                    ×
                  </button>
                </div>
                <input
                  aria-label={`Note for ${x.product?.name}`}
                  placeholder="Note for staff (optional)"
                  maxLength={240}
                  value={notes[x.id] || ''}
                  disabled={!!pending || busy}
                  onChange={(e) =>
                    setNotes((n) => ({ ...n, [x.id]: e.target.value }))
                  }
                />
              </div>
            ))}
            <div className="total">
              <span>Total</span>
              <strong>{money(total)}</strong>
            </div>
          </section>
          {settings.paymentMode === 'PER_ORDER' ? (
            <>
              <h2>Payment</h2>
              <div className="payment-options">
                {(['CASH', 'PROMPTPAY'] as const).map((m) => (
                  <label key={m} className={method === m ? 'selected' : ''}>
                    <input
                      type="radio"
                      name="payment"
                      checked={method === m}
                      disabled={
                        !!pending ||
                        busy ||
                        (m === 'PROMPTPAY' && !settings.promptpayId)
                      }
                      onChange={() => setMethod(m)}
                    />
                    <strong>{m === 'CASH' ? 'Cash' : 'PromptPay'}</strong>
                    <small>
                      {m === 'PROMPTPAY'
                        ? 'Transfer and let staff confirm'
                        : 'Pay staff directly'}
                    </small>
                  </label>
                ))}
              </div>
            </>
          ) : (
            <div className="notice">
              {settings.paymentMode === 'AT_CHECKOUT'
                ? 'Pay when your session closes.'
                : 'Staff will handle payment separately.'}
            </div>
          )}
          <Action
            disabled={busy || (!pending && (!count || invalid))}
            onClick={() => void submit()}
          >
            {busy
              ? 'Submitting…'
              : pending
                ? 'Retry this order safely'
                : `Place order · ${money(total)}`}
          </Action>
        </>
      )}
      <footer>
        {branch.name} · {location}
      </footer>
    </main>
  );
}

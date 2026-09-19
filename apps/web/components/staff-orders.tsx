'use client';
import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { orderingApi } from '@repo/api-client';
import { clientFetch } from '../lib/fetch/client';
import { StaffShell } from './staff-shell';
import { OrderCard } from './order-card';
import { Action, ErrorNotice, money } from './shared';
export function StaffOrders({
  history = false,
  id,
}: {
  history?: boolean;
  id?: string;
}) {
  return (
    <StaffShell>
      <Orders history={history} id={id} />
    </StaffShell>
  );
}
function Orders({ history, id }: { history: boolean; id?: string }) {
  const cache = useQueryClient();
  const [cursor, setCursor] = useState<string | undefined>();
  const [filter, setFilter] = useState('ALL');
  const [connected, setConnected] = useState(false);
  const [sound, setSound] = useState(false);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const audio = useRef<AudioContext | null>(null);
  const seen = useRef(new Set<string>());
  const orders = useQuery({
    queryKey: ['staff-orders', history, cursor, id],
    queryFn: async () =>
      id
        ? {
            orders: [await clientFetch(orderingApi.detail(id))],
            nextCursor: null,
          }
        : clientFetch(orderingApi.orders(history, cursor)),
    refetchInterval: 15000,
  });
  const summary = useQuery({
    queryKey: ['summary'],
    queryFn: () => clientFetch(orderingApi.summary()),
    refetchInterval: 30000,
  });
  useEffect(() => {
    if (history) return;
    const events = new EventSource('/api/staff/events');
    events.onopen = () => {
      setConnected(true);
      void cache.invalidateQueries({ queryKey: ['staff-orders'] });
    };
    events.onerror = () => setConnected(false);
    events.onmessage = (event) => {
      const data = JSON.parse(event.data as string) as {
        kind: string;
        orderId: string;
      };
      if (data.kind === 'new' && !seen.current.has(data.orderId)) {
        seen.current.add(data.orderId);
        setFresh((current) => new Set([...current, data.orderId]));
        if (sound && audio.current?.state === 'running') {
          const ctx = audio.current;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = 880;
          gain.gain.setValueAtTime(0.12, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
          osc.start();
          osc.stop(ctx.currentTime + 0.4);
        }
      }
      if (data.kind !== 'heartbeat') {
        void cache.invalidateQueries({ queryKey: ['staff-orders'] });
        void cache.invalidateQueries({ queryKey: ['summary'] });
      }
    };
    return () => events.close();
  }, [cache, history, sound]);
  const visible =
    orders.data?.orders.filter(
      (o) => filter === 'ALL' || o.status === filter,
    ) || [];
  return (
    <>
      <header className="page-heading">
        <div>
          <div className="eyebrow">THE BAR / SERVICE</div>
          <h1>
            {history
              ? 'Order history'
              : id
                ? 'Order details'
                : 'Keep the rounds moving.'}
          </h1>
          <p>
            {history
              ? 'A permanent record of each independent order.'
              : 'Every table. Every round. Right here.'}
          </p>
        </div>
        {!history && (
          <div className="connection">
            <span className={connected ? 'online' : ''}>
              ●{' '}
              {connected
                ? 'Live connection'
                : 'Reconnecting · polling every 15s'}
            </span>
            <button
              onClick={() => {
                if (!audio.current) audio.current = new AudioContext();
                void audio.current.resume().then(() => setSound((s) => !s));
              }}
            >
              {sound ? '♪ Sound on' : 'Enable sound'}
            </button>
          </div>
        )}
      </header>
      <ErrorNotice error={orders.error || summary.error} />
      {summary.data && (
        <section className="summary-strip">
          <div>
            <small>Today · {summary.data.date} · Bangkok</small>
            <strong>{summary.data.orderCount} orders</strong>
          </div>
          <div>
            <small>Payments received</small>
            <strong>{money(summary.data.total)}</strong>
          </div>
          <div>
            <small>Cash</small>
            <strong>{money(summary.data.cash)}</strong>
          </div>
          <div>
            <small>QR</small>
            <strong>{money(summary.data.qr)}</strong>
          </div>
        </section>
      )}
      <div className="board-toolbar">
        <div className="filters">
          {[
            'ALL',
            'NEW',
            'ACCEPTED',
            'PREPARING',
            'SERVED',
            ...(history ? ['CANCELLED'] : []),
          ].map((f) => (
            <button
              key={f}
              className={filter === f ? 'selected' : ''}
              onClick={() => setFilter(f)}
            >
              {f === 'ALL' ? 'All orders' : f.toLowerCase()}
            </button>
          ))}
        </div>
        <span className="muted">{visible.length} shown</span>
      </div>
      {orders.isPending ? (
        <div className="empty">Loading orders…</div>
      ) : visible.length ? (
        <div className="orders-grid">
          {visible.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              highlight={fresh.has(order.id)}
            />
          ))}
        </div>
      ) : (
        <div className="empty">
          <span>✓</span>
          <h2>{history ? 'No orders on this page' : 'All caught up.'}</h2>
          <p>
            {history
              ? 'Change the filter or return to the latest orders.'
              : 'New orders will appear here automatically.'}
          </p>
        </div>
      )}
      {history && (
        <div className="row">
          <Action secondary onClick={() => setCursor(undefined)}>
            Latest orders
          </Action>
          {orders.data?.nextCursor && (
            <Action onClick={() => setCursor(orders.data.nextCursor!)}>
              Older orders →
            </Action>
          )}
        </div>
      )}
      <footer>
        {history
          ? 'Sales use confirmed payments by receipt date in Bangkok. Cancelled orders are excluded from the order count.'
          : 'Served orders with pending payment remain visible until payment is received.'}
      </footer>
    </>
  );
}

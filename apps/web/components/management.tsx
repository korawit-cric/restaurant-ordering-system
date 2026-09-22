'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import {
  orderingApi,
  type ServicePoint,
  type OrderSession,
  type BranchSettings,
  type Preset,
  type Product,
} from '@repo/api-client';
import { clientFetch } from '../lib/fetch/client';
import { StaffShell } from './staff-shell';
import { Action, ErrorNotice, money, Status } from './shared';
export function Categories() {
  return (
    <StaffShell admin>
      <CategoryBody />
    </StaffShell>
  );
}
function CategoryBody() {
  const cache = useQueryClient(),
    q = useQuery({
      queryKey: ['categories'],
      queryFn: () => clientFetch(orderingApi.categories()),
    });
  const [name, setName] = useState(''),
    [error, setError] = useState<unknown>(null);
  async function save(body: unknown, id?: string) {
    try {
      await clientFetch(orderingApi.saveCategory(body, id));
      await cache.invalidateQueries({ queryKey: ['categories'] });
      setName('');
    } catch (e) {
      setError(e);
    }
  }
  return (
    <>
      <h1>Categories</h1>
      <p>Set the order customers browse your menu.</p>
      <ErrorNotice error={error} />
      <form
        className="panel row"
        onSubmit={(e) => {
          e.preventDefault();
          void save({
            name,
            sortOrder: (q.data?.length || 0) * 10,
            active: true,
          });
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="New category"
        />
        <Action type="submit">Add</Action>
      </form>
      <div className="panel management-list">
        {q.data?.map((c) => (
          <div className="management-row" key={c.id}>
            <strong className="management-name">{c.name}</strong>
            <span>#{c.sortOrder}</span>
            <label className="toggle">
              <input
                type="checkbox"
                checked={c.active}
                onChange={(e) => void save({ active: e.target.checked }, c.id)}
              />
              Active
            </label>
            <button
              onClick={() => {
                const v = prompt('Category name', c.name);
                if (v) void save({ name: v }, c.id);
              }}
            >
              Rename
            </button>
            <button
              onClick={() => {
                const v = prompt('Display order', String(c.sortOrder));
                if (v !== null) void save({ sortOrder: Number(v) }, c.id);
              }}
            >
              Order
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
export function Products() {
  return (
    <StaffShell admin>
      <ProductBody />
    </StaffShell>
  );
}
function ProductBody() {
  const cache = useQueryClient(),
    categories = useQuery({
      queryKey: ['categories'],
      queryFn: () => clientFetch(orderingApi.categories()),
    }),
    q = useQuery({
      queryKey: ['products'],
      queryFn: () => clientFetch(orderingApi.products()),
    });
  const [name, setName] = useState(''),
    [price, setPrice] = useState(''),
    [categoryId, setCategoryId] = useState(''),
    [editing, setEditing] = useState<Product | null>(null),
    [error, setError] = useState<unknown>(null);
  async function save(body: unknown, id?: string) {
    try {
      await clientFetch(orderingApi.saveProduct(body, id));
      await cache.invalidateQueries({ queryKey: ['products'] });
      setName('');
      setPrice('');
      return true;
    } catch (e) {
      setError(e);
      return false;
    }
  }
  return (
    <>
      <h1>Menu products</h1>
      <p>
        Availability changes are immediate and historical order prices stay
        fixed.
      </p>
      <ErrorNotice error={error} />
      <form
        className="panel setup-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save({
            name,
            categoryId: categoryId || categories.data?.[0]?.id,
            price,
            sortOrder: (q.data?.length || 0) * 10,
            active: true,
            available: true,
          });
        }}
      >
        <label>
          Product
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Leo beer"
          />
        </label>
        <label>
          Category
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            required
          >
            <option value="">Choose category</option>
            {categories.data
              ?.filter((c) => c.active)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Price in baht
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            required
            placeholder="80.00"
          />
        </label>
        <Action type="submit">Add product</Action>
      </form>
      <div className="panel management-list">
        {q.data?.map((p) => (
          <div className="management-row" key={p.id}>
            <div className="management-name">
              <strong>{p.name}</strong>
              <small>
                {categories.data?.find((c) => c.id === p.categoryId)?.name} ·{' '}
                {money(p.price)}
              </small>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={p.available}
                onChange={(e) => {
                  const available = e.target.checked;
                  const previous = cache.getQueryData<Product[]>(['products']);
                  cache.setQueryData<Product[]>(['products'], (items) =>
                    items?.map((item) =>
                      item.id === p.id ? { ...item, available } : item,
                    ),
                  );
                  void (async () => {
                    try {
                      await clientFetch(
                        orderingApi.availability(p.id, available),
                      );
                    } catch (err) {
                      cache.setQueryData(['products'], previous);
                      setError(err);
                    } finally {
                      await cache.invalidateQueries({ queryKey: ['products'] });
                    }
                  })();
                }}
              />
              Available
            </label>
            <button onClick={() => setEditing(p)}>Edit</button>
            <button onClick={() => void save({ active: !p.active }, p.id)}>
              {p.active ? 'Archive' : 'Restore'}
            </button>
          </div>
        ))}
      </div>
      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <form
            className="modal setup-form"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void save(
                {
                  name: f.get('name'),
                  categoryId: f.get('categoryId'),
                  price: f.get('price'),
                  description: f.get('description') || null,
                  imageUrl: f.get('imageUrl') || null,
                  sortOrder: Number(f.get('sortOrder')),
                },
                editing.id,
              ).then((saved) => {
                if (saved) setEditing(null);
              });
            }}
          >
            <h2>Edit product</h2>
            <label>
              Name
              <input name="name" defaultValue={editing.name} required />
            </label>
            <label>
              Category
              <select name="categoryId" defaultValue={editing.categoryId}>
                {categories.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Price (฿)
              <input
                name="price"
                inputMode="decimal"
                defaultValue={editing.price}
                required
              />
            </label>
            <label>
              Description
              <textarea
                name="description"
                defaultValue={editing.description || ''}
                maxLength={500}
              />
            </label>
            <label>
              HTTPS image URL
              <input
                name="imageUrl"
                type="url"
                defaultValue={editing.imageUrl || ''}
              />
            </label>
            <label>
              Display order
              <input
                name="sortOrder"
                type="number"
                min={0}
                max={9999}
                defaultValue={editing.sortOrder}
              />
            </label>
            <Action type="submit">Save product</Action>
            <button type="button" onClick={() => setEditing(null)}>
              Close
            </button>
          </form>
        </div>
      )}
    </>
  );
}
export function QrPrint({
  url,
  title,
  description,
  onClose,
}: {
  url: string;
  title: string;
  description?: string | null;
  onClose: () => void;
}) {
  const [data, setData] = useState('');
  const [format, setFormat] = useState<'a4' | 'thermal'>('a4');
  useEffect(() => {
    void QRCode.toDataURL(url, { width: 640, margin: 2 }).then(setData);
  }, [url]);
  return (
    <div className="modal-backdrop qr-modal" onClick={onClose}>
      <div
        className={`modal print-card ${format}`}
        onClick={(e) => e.stopPropagation()}
      >
        {format === 'thermal' && (
          <style>{'@page { size: 80mm 200mm; margin: 4mm; }'}</style>
        )}
        <div className="eyebrow">SCAN TO ORDER</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        {data && <img src={data} alt={`QR for ${title}`} />}
        <p>{url}</p>
        <div className="row no-print">
          <select
            aria-label="Print format"
            value={format}
            onChange={(e) => setFormat(e.target.value as 'a4' | 'thermal')}
          >
            <option value="a4">A4</option>
            <option value="thermal">Receipt / 80 mm</option>
          </select>
          <button onClick={() => window.print()}>Print</button>
          <a
            className="button secondary"
            href={data}
            download={`${title.replace(/[^a-z0-9]/gi, '-')}-qr.png`}
          >
            Download PNG
          </a>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
export function Points() {
  return (
    <StaffShell admin>
      <PointBody />
    </StaffShell>
  );
}
function PointBody() {
  const cache = useQueryClient(),
    q = useQuery({
      queryKey: ['points'],
      queryFn: () => clientFetch(orderingApi.points()),
    }),
    branch = useQuery({
      queryKey: ['branch'],
      queryFn: () => clientFetch(orderingApi.branch()),
    });
  const [name, setName] = useState(''),
    [type, setType] = useState('TABLE'),
    [print, setPrint] = useState<ServicePoint | null>(null),
    [error, setError] = useState<unknown>(null);
  async function save(body: unknown, id?: string) {
    try {
      await clientFetch(orderingApi.savePoint(body, id));
      await cache.invalidateQueries({ queryKey: ['points'] });
      setName('');
    } catch (e) {
      setError(e);
    }
  }
  return (
    <>
      <h1>Service points</h1>
      <p>
        Tables, seats, zones, counters, or pickup points. Permanent QR codes
        stay valid until rotated.
      </p>
      <ErrorNotice error={error} />
      <form
        className="panel setup-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save({ name, type });
        }}
      >
        <label>
          Name
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Table A7"
          />
        </label>
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {['TABLE', 'BAR_SEAT', 'ZONE', 'COUNTER', 'PICKUP', 'OTHER'].map(
              (x) => (
                <option key={x}>{x}</option>
              ),
            )}
          </select>
        </label>
        <Action type="submit">Add location</Action>
      </form>
      <div className="tables-grid">
        {q.data?.map((p) => (
          <article className="panel table-card" key={p.id}>
            <h2>{p.name}</h2>
            <Status value={p.active ? 'ACTIVE' : 'INACTIVE'} />
            <p>{p.description || p.type}</p>
            {branch.data?.settings.qrMode === 'PERMANENT' && (
              <button onClick={() => setPrint(p)}>Show / print QR</button>
            )}
            <button
              onClick={() => {
                const v = prompt('Location name', p.name);
                if (v) void save({ name: v }, p.id);
              }}
            >
              Rename
            </button>
            <button onClick={() => void save({ active: !p.active }, p.id)}>
              {p.active ? 'Deactivate' : 'Activate'}
            </button>
            <button
              onClick={() => {
                if (confirm('Rotate QR? Old printed codes will stop working.'))
                  void clientFetch(orderingApi.rotate(p.id)).then(() =>
                    cache.invalidateQueries({ queryKey: ['points'] }),
                  );
              }}
            >
              Rotate token
            </button>
          </article>
        ))}
      </div>
      {print && (
        <QrPrint
          url={`${location.origin}/q/${print.qrToken}`}
          title={`${branch.data?.tenant?.name || ''} · ${print.name}`}
          description={print.description}
          onClose={() => setPrint(null)}
        />
      )}
    </>
  );
}
export function Sessions() {
  return (
    <StaffShell>
      <SessionBody />
    </StaffShell>
  );
}
function SessionBody() {
  const cache = useQueryClient(),
    q = useQuery({
      queryKey: ['sessions'],
      queryFn: () => clientFetch(orderingApi.sessions()),
      refetchInterval: 10000,
    }),
    points = useQuery({
      queryKey: ['points'],
      queryFn: () => clientFetch(orderingApi.points()),
    }),
    branch = useQuery({
      queryKey: ['branch'],
      queryFn: () => clientFetch(orderingApi.branch()),
    });
  const [point, setPoint] = useState(''),
    [label, setLabel] = useState(''),
    [description, setDescription] = useState(''),
    [print, setPrint] = useState<OrderSession | null>(null),
    [error, setError] = useState<unknown>(null);
  async function action(fn: () => Promise<unknown>) {
    try {
      setError(null);
      await fn();
      await cache.invalidateQueries({ queryKey: ['sessions'] });
    } catch (e) {
      setError(e);
    }
  }
  return (
    <>
      <h1>Active sessions</h1>
      <p>
        Temporary QR codes continue to work when you move a guest to another
        location.
      </p>
      <ErrorNotice error={error} />
      {branch.data?.settings.qrMode === 'SESSION' && (
        <form
          className="panel setup-form"
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              const s = await clientFetch(
                orderingApi.openSession({
                  servicePointId: point || null,
                  label: label || undefined,
                  description: description || null,
                }),
              );
              setPrint(s);
              setLabel('');
              setDescription('');
            });
          }}
        >
          <label>
            Location
            <select value={point} onChange={(e) => setPoint(e.target.value)}>
              <option value="">Flexible location</option>
              {points.data
                ?.filter((p) => p.active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Label
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="A3"
            />
          </label>
          <label>
            Description
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Left side of bar"
            />
          </label>
          <Action type="submit">Create session QR</Action>
        </form>
      )}
      <div className="tables-grid">
        {q.data?.map((s) => (
          <article className="panel table-card" key={s.id}>
            <h2>{s.label || s.servicePoint?.name || 'Flexible'}</h2>
            <p>{s.description}</p>
            <p>
              Opened {new Date(s.openedAt).toLocaleTimeString()} ·{' '}
              {s._count?.orders || 0} orders
            </p>
            {s.status === 'OPEN' &&
              branch.data?.settings.qrMode === 'SESSION' && (
                <button onClick={() => setPrint(s)}>Print QR</button>
              )}
            {s.status === 'CLOSED' && (
              <p>
                Awaiting {s.paymentMethod} checkout · {money(s.subtotal)}
              </p>
            )}
            {s.status === 'CLOSED' && s.paymentMethod === 'PROMPTPAY' && (
              <button
                onClick={() =>
                  void action(async () => {
                    const qr = await clientFetch(
                      orderingApi.sessionPromptpay(s.id),
                    );
                    const win = window.open('', '_blank');
                    if (win)
                      win.document.write(
                        `<html><body><h1>PromptPay ${qr.amount} THB</h1>${qr.svg}<p>Confirm payment manually after checking the restaurant account.</p></body></html>`,
                      );
                  })
                }
              >
                Show PromptPay QR
              </button>
            )}
            {s.status === 'CLOSED' && (
              <button
                onClick={() => {
                  if (confirm('Confirm full payment received?'))
                    void action(() =>
                      clientFetch(orderingApi.confirmSession(s.id)),
                    );
                }}
              >
                Confirm checkout payment
              </button>
            )}
            {s.status === 'OPEN' && (
              <button
                onClick={() => {
                  const v = prompt('New location label', s.label || '');
                  if (v !== null)
                    void action(() =>
                      clientFetch(
                        orderingApi.updateSession(s.id, { label: v }),
                      ),
                    );
                }}
              >
                Change location
              </button>
            )}
            {s.status === 'OPEN' && (
              <label>
                Service point
                <select
                  value={s.servicePointId || ''}
                  onChange={(e) => {
                    const servicePointId = e.target.value || null;
                    void action(() =>
                      clientFetch(
                        orderingApi.updateSession(s.id, { servicePointId }),
                      ),
                    );
                  }}
                >
                  <option value="">Flexible location</option>
                  {points.data
                    ?.filter((p) => p.active)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {s.status === 'OPEN' && (
              <button
                onClick={() => {
                  const v = prompt('Description', s.description || '');
                  if (v !== null)
                    void action(() =>
                      clientFetch(
                        orderingApi.updateSession(s.id, { description: v }),
                      ),
                    );
                }}
              >
                Edit description
              </button>
            )}
            {s.status === 'OPEN' && (
              <button
                onClick={() => {
                  const mode = branch.data?.settings.paymentMode;
                  const m =
                    mode === 'AT_CHECKOUT'
                      ? prompt(
                          'Checkout payment: CASH or PROMPTPAY',
                          'CASH',
                        )?.toUpperCase()
                      : undefined;
                  if (
                    mode === 'AT_CHECKOUT' &&
                    m !== 'CASH' &&
                    m !== 'PROMPTPAY'
                  )
                    return;
                  void action(() =>
                    clientFetch(
                      orderingApi.closeSession(
                        s.id,
                        m as 'CASH' | 'PROMPTPAY' | undefined,
                      ),
                    ),
                  );
                }}
              >
                Close session
              </button>
            )}
          </article>
        ))}
      </div>
      {print && (
        <QrPrint
          url={`${location.origin}/s/${print.token}`}
          title={`${branch.data?.tenant?.name || ''} · ${print.label || print.servicePoint?.name || 'Session'}`}
          description={print.description}
          onClose={() => setPrint(null)}
        />
      )}
    </>
  );
}
export function Settings() {
  return (
    <StaffShell admin>
      <SettingsBody />
    </StaffShell>
  );
}
function SettingsBody() {
  const cache = useQueryClient(),
    q = useQuery({
      queryKey: ['branch'],
      queryFn: () => clientFetch(orderingApi.branch()),
    });
  const [error, setError] = useState<unknown>(null),
    [promptpay, setPromptpay] = useState('');
  useEffect(() => {
    if (q.data) setPromptpay(q.data.settings.promptpayId || '');
  }, [q.data]);
  async function preset(p: Preset) {
    try {
      await clientFetch(orderingApi.preset(p));
      await cache.invalidateQueries({ queryKey: ['branch'] });
    } catch (e) {
      setError(e);
    }
  }
  return (
    <>
      <h1>Branch settings</h1>
      <p>
        Start from a preset and keep ordering simple for your service style.
      </p>
      <ErrorNotice error={error} />
      <section className="panel">
        <h2>Workflow preset</h2>
        <p>Current: {q.data?.settings.preset}</p>
        <div className="preset-grid">
          {(
            [
              'TABLE_SERVICE',
              'BAR_FLEXIBLE',
              'QUICK_SERVICE',
              'PICKUP_STALL',
            ] as Preset[]
          ).map((p) => (
            <button key={p} onClick={() => void preset(p)}>
              {p.replaceAll('_', ' ')}
            </button>
          ))}
        </div>
        <p>
          QR: {q.data?.settings.qrMode} · Session:{' '}
          {q.data?.settings.sessionMode} · Payment:{' '}
          {q.data?.settings.paymentMode} · Fulfillment:{' '}
          {q.data?.settings.fulfillmentMode}
        </p>
      </section>
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          if (!q.data) return;
          void clientFetch(
            orderingApi.settings({
              qrMode: q.data.settings.qrMode,
              sessionMode: q.data.settings.sessionMode,
              paymentMode: q.data.settings.paymentMode,
              fulfillmentMode: q.data.settings.fulfillmentMode,
              promptpayId: promptpay || null,
            }),
          )
            .then(() => cache.invalidateQueries({ queryKey: ['branch'] }))
            .catch(setError);
        }}
      >
        <h2>PromptPay recipient</h2>
        <p>
          Mobile, national ID, or e-wallet ID. Payments require staff
          confirmation.
        </p>
        <input
          value={promptpay}
          onChange={(e) => setPromptpay(e.target.value)}
          placeholder="0812345678"
        />
        <Action type="submit">Save settings</Action>
      </form>
      <AdvancedWorkflow />
    </>
  );
}
export function Onboarding() {
  return (
    <StaffShell admin>
      <OnboardingBody />
    </StaffShell>
  );
}
function OnboardingBody() {
  const q = useQuery({
    queryKey: ['onboarding'],
    queryFn: () => clientFetch(orderingApi.onboarding()),
    refetchInterval: 10000,
  });
  const links: { [key: string]: string } = {
    restaurant: '/admin/settings',
    menu: '/admin/categories',
    servicePoints: '/admin/service-points',
    qr: '/admin/service-points',
    firstOrder: '/staff/orders',
  };
  return (
    <>
      <h1>Get ready to receive orders</h1>
      <p>Set up your restaurant without special hardware.</p>
      <div className="panel">
        {q.data?.steps.map((s) => (
          <Link
            key={s.key}
            href={links[s.key] || '#'}
            className="management-row"
          >
            <strong>
              {s.done ? '✓' : '○'}{' '}
              {s.key === 'servicePoints'
                ? 'Add service points'
                : s.key === 'firstOrder'
                  ? 'Receive your first test order'
                  : s.key === 'qr'
                    ? 'Print QR codes'
                    : s.key === 'menu'
                      ? 'Add menu and products'
                      : 'Configure restaurant'}
            </strong>
            <span>→</span>
          </Link>
        ))}
      </div>
      <Link className="button primary" href="/staff/orders">
        Open staff dashboard
      </Link>
    </>
  );
}
export function Reports() {
  return (
    <StaffShell>
      <ReportsBody />
    </StaffShell>
  );
}
function ReportsBody() {
  const q = useQuery({
    queryKey: ['summary'],
    queryFn: () => clientFetch(orderingApi.summary()),
    refetchInterval: 60000,
  });
  const daily = useQuery({
    queryKey: ['daily', 7],
    queryFn: () => clientFetch(orderingApi.daily(7)),
    refetchInterval: 60000,
  });
  return (
    <>
      <h1>Today</h1>
      <p>Simple branch sales summary based on confirmed payments.</p>
      {q.data && (
        <>
          <div className="summary-strip">
            <div>
              <small>Orders</small>
              <strong>{q.data.orderCount}</strong>
            </div>
            <div>
              <small>Paid sales</small>
              <strong>{money(q.data.total)}</strong>
            </div>
            <div>
              <small>Cash</small>
              <strong>{money(q.data.cash)}</strong>
            </div>
            <div>
              <small>PromptPay</small>
              <strong>{money(q.data.promptpay)}</strong>
            </div>
          </div>
          <section className="panel">
            <h2>Top products</h2>
            {q.data.topProducts.map((p, i) => (
              <div className="management-row" key={i}>
                <strong>{p.productNameSnapshot}</strong>
                <span>{p._sum.quantity || 0} sold</span>
              </div>
            ))}
          </section>
          <section className="panel">
            <h2>Sales by day</h2>
            {daily.data?.map((day) => (
              <div className="management-row" key={day.date}>
                <strong className="management-name">{day.date}</strong>
                <span>Cash {money(day.cash)}</span>
                <span>PromptPay {money(day.promptpay)}</span>
                <strong>{money(day.total)}</strong>
              </div>
            ))}
          </section>
        </>
      )}
    </>
  );
}
export function Branches() {
  return (
    <StaffShell admin>
      <BranchBody />
    </StaffShell>
  );
}
function BranchBody() {
  const cache = useQueryClient(),
    q = useQuery({
      queryKey: ['branches'],
      queryFn: () => clientFetch(orderingApi.branches()),
    });
  const [error, setError] = useState<unknown>(null);
  return (
    <>
      <h1>Branches</h1>
      <p>Your subscription controls how many active branches you can run.</p>
      <ErrorNotice error={error} />
      <form
        className="panel setup-form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void clientFetch(
            orderingApi.newBranch({
              name: f.get('name'),
              slug: f.get('slug'),
              timezone: f.get('timezone'),
              preset: f.get('preset'),
            }),
          )
            .then(() => cache.invalidateQueries({ queryKey: ['branches'] }))
            .catch(setError);
        }}
      >
        <label>
          Name
          <input name="name" required placeholder="Second branch" />
        </label>
        <label>
          Slug
          <input
            name="slug"
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            placeholder="second"
          />
        </label>
        <label>
          Timezone
          <input name="timezone" defaultValue="Asia/Bangkok" required />
        </label>
        <label>
          Workflow
          <select name="preset">
            <option value="BAR_FLEXIBLE">Bar / flexible seating</option>
            <option value="TABLE_SERVICE">Table service</option>
            <option value="QUICK_SERVICE">Quick service</option>
            <option value="PICKUP_STALL">Pickup / food stall</option>
          </select>
        </label>
        <Action type="submit">Create branch</Action>
      </form>
      <div className="panel management-list">
        {q.data?.map((b) => (
          <div className="management-row" key={b.id}>
            <strong className="management-name">
              {b.name}
              <small>
                {b.slug} · {b.timezone}
              </small>
            </strong>
            <Status value={b.status} />
          </div>
        ))}
      </div>
    </>
  );
}
export function StaffUsers() {
  return (
    <StaffShell admin>
      <StaffBody />
    </StaffShell>
  );
}
function StaffBody() {
  const cache = useQueryClient(),
    me = useQuery({
      queryKey: ['me'],
      queryFn: () => clientFetch(orderingApi.me()),
    }),
    q = useQuery({
      queryKey: ['staff-users'],
      queryFn: () => clientFetch(orderingApi.staff()),
    }),
    invitations = useQuery({
      queryKey: ['staff-invitations'],
      queryFn: () => clientFetch(orderingApi.invitations()),
    });
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState(false);
  return (
    <>
      <h1>Staff accounts</h1>
      <p>
        Invite a manager or staff member by email. The link expires in 48 hours.
        They choose their own password when accepting.
      </p>
      <ErrorNotice error={error} />
      {sent && <p>Invitation sent. Ask the recipient to check their email.</p>}
      {me.data?.role === 'OWNER' && (
        <form
          className="panel setup-form"
          onSubmit={(e) => {
            e.preventDefault();
            setSent(false);
            const f = new FormData(e.currentTarget);
            void clientFetch(
              orderingApi.sendInvitation(
                f.get('email') as string,
                f.get('role') as 'MANAGER' | 'STAFF',
              ),
            )
              .then(() => {
                setSent(true);
                return cache.invalidateQueries({
                  queryKey: ['staff-invitations'],
                });
              })
              .catch(setError);
          }}
        >
          <label>
            Email
            <input name="email" type="email" required />
          </label>
          <label>
            Role
            <select name="role">
              <option value="STAFF">Staff</option>
              <option value="MANAGER">Manager</option>
            </select>
          </label>
          <Action type="submit">Send invitation</Action>
        </form>
      )}
      {!!invitations.data?.length && (
        <div className="panel management-list">
          <h2>Pending invitations</h2>
          {invitations.data.map((invite) => (
            <div className="management-row" key={invite.id}>
              <strong className="management-name">
                {invite.email}
                <small>{invite.role}</small>
              </strong>
              <span>
                Expires {new Date(invite.expiresAt).toLocaleDateString()}
              </span>
              {me.data?.role === 'OWNER' && (
                <button
                  onClick={() => {
                    if (!confirm(`Revoke invitation for ${invite.email}?`))
                      return;
                    void clientFetch(orderingApi.revokeInvitation(invite.id))
                      .then(() =>
                        cache.invalidateQueries({
                          queryKey: ['staff-invitations'],
                        }),
                      )
                      .catch(setError);
                  }}
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="panel management-list">
        {q.data?.map((u) => (
          <div className="management-row" key={u.id}>
            <strong className="management-name">
              {u.email}
              <small>{u.role}</small>
            </strong>
            <Status value={u.active ? 'ACTIVE' : 'INACTIVE'} />
            {me.data?.role === 'OWNER' && u.role !== 'OWNER' && (
              <button
                onClick={() => {
                  if (
                    confirm(
                      `${u.active ? 'Deactivate' : 'Activate'} ${u.email}?`,
                    )
                  )
                    void clientFetch(
                      orderingApi.updateStaff(u.id, { active: !u.active }),
                    )
                      .then(() =>
                        cache.invalidateQueries({ queryKey: ['staff-users'] }),
                      )
                      .catch(setError);
                }}
              >
                {u.active ? 'Deactivate' : 'Activate'}
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
export function AdvancedWorkflow() {
  const cache = useQueryClient(),
    q = useQuery({
      queryKey: ['branch'],
      queryFn: () => clientFetch(orderingApi.branch()),
    });
  const [error, setError] = useState<unknown>(null);
  if (!q.data) return null;
  const settings = q.data.settings;
  return (
    <section className="panel">
      <h2>Advanced workflow</h2>
      <p>
        Change these only when your service flow needs a different combination.
        Close active sessions first.
      </p>
      <ErrorNotice error={error} />
      <form
        key={settings.preset + settings.qrMode + settings.paymentMode}
        className="setup-form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void clientFetch(
            orderingApi.settings({
              qrMode: f.get('qrMode') as BranchSettings['qrMode'],
              sessionMode: f.get(
                'sessionMode',
              ) as BranchSettings['sessionMode'],
              paymentMode: f.get(
                'paymentMode',
              ) as BranchSettings['paymentMode'],
              fulfillmentMode: f.get(
                'fulfillmentMode',
              ) as BranchSettings['fulfillmentMode'],
              promptpayId: settings.promptpayId,
            }),
          )
            .then(() => cache.invalidateQueries({ queryKey: ['branch'] }))
            .catch(setError);
        }}
      >
        <label>
          QR type
          <select name="qrMode" defaultValue={settings.qrMode}>
            <option>PERMANENT</option>
            <option>SESSION</option>
          </select>
        </label>
        <label>
          Session type
          <select name="sessionMode" defaultValue={settings.sessionMode}>
            <option>SINGLE_ORDER</option>
            <option>OPEN_SESSION</option>
          </select>
        </label>
        <label>
          Payment timing
          <select name="paymentMode" defaultValue={settings.paymentMode}>
            <option>PER_ORDER</option>
            <option>AT_CHECKOUT</option>
            <option>STAFF_MANAGED</option>
          </select>
        </label>
        <label>
          Fulfillment
          <select
            name="fulfillmentMode"
            defaultValue={settings.fulfillmentMode}
          >
            <option>SERVE_TO_LOCATION</option>
            <option>PICKUP</option>
          </select>
        </label>
        <Action type="submit">Save workflow</Action>
      </form>
    </section>
  );
}

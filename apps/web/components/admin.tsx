'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  orderingApi,
  type Category,
  type MenuItem,
  type Table,
} from '@repo/api-client';
import { clientFetch } from '../lib/fetch/client';
import { StaffShell } from './staff-shell';
import { Action, ErrorNotice, money, Status } from './shared';
type Kind = 'menu' | 'categories' | 'tables';
export function Admin({ kind }: { kind: Kind }) {
  return (
    <StaffShell admin>
      <Management kind={kind} />
    </StaffShell>
  );
}
function Management({ kind }: { kind: Kind }) {
  const cache = useQueryClient();
  const [editing, setEditing] = useState<
    Category | MenuItem | Table | null | undefined
  >(undefined);
  const [qr, setQr] = useState<Table | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const categories = useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: () => clientFetch(orderingApi.categories()),
  });
  const items = useQuery({
    queryKey: ['admin', 'menu'],
    queryFn: () => clientFetch(orderingApi.items()),
    enabled: kind === 'menu',
  });
  const tables = useQuery({
    queryKey: ['admin', 'tables'],
    queryFn: () => clientFetch(orderingApi.tables()),
    enabled: kind === 'tables',
  });
  const data: (Category | MenuItem | Table)[] | undefined =
    kind === 'menu'
      ? items.data
      : kind === 'tables'
        ? tables.data
        : categories.data;
  async function save(body: unknown, id?: string) {
    setBusy(true);
    setError(null);
    try {
      await clientFetch(orderingApi.save(kind, body, id));
      await cache.invalidateQueries({ queryKey: ['admin', kind] });
      await cache.invalidateQueries({ queryKey: ['menu'] });
      setEditing(undefined);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function rotate(table: Table) {
    if (
      !confirm(
        `Replace the QR for table ${table.name}? Printed old codes will stop working, including open customer pages.`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await clientFetch(orderingApi.rotate(table.id));
      await tables.refetch();
      setQr(null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="page-heading">
        <div>
          <div className="eyebrow">MANAGE YOUR RESTAURANT</div>
          <h1>
            {kind === 'menu'
              ? 'A menu for tonight.'
              : kind === 'tables'
                ? 'Every table, connected.'
                : 'Keep it organised.'}
          </h1>
          <p>
            {kind === 'menu'
              ? 'One tap to mark an item sold out. Past orders keep their original prices.'
              : kind === 'tables'
                ? 'Permanent table codes. Fresh, independent orders every time.'
                : 'Set the order your customers browse.'}
          </p>
        </div>
        <Action
          onClick={() => {
            setEditing(null);
            setError(null);
          }}
        >
          + Add{' '}
          {kind === 'menu' ? 'item' : kind === 'tables' ? 'table' : 'category'}
        </Action>
      </header>
      <ErrorNotice
        error={error || categories.error || items.error || tables.error}
      />
      {kind === 'tables' ? (
        <div className="tables-grid">
          {(data as Table[] | undefined)?.map((table) => (
            <article key={table.id} className="panel table-card">
              <div className="row">
                <h2>{table.name}</h2>
                <Status value={table.active ? 'ACTIVE' : 'INACTIVE'} />
              </div>
              <img
                className="table-qr"
                src={`/api/admin/tables/${table.id}/qr?v=${table.qrToken}`}
                alt={`Table ${table.name} QR`}
              />
              <a href={`/t/${table.qrToken}`} target="_blank" rel="noreferrer">
                Open customer menu ↗
              </a>
              <div className="row">
                <Action secondary onClick={() => setQr(table)}>
                  Print / download
                </Action>
                <button onClick={() => setEditing(table)}>Edit</button>
              </div>
              <div className="row">
                <button
                  disabled={busy}
                  onClick={() => void save({ active: !table.active }, table.id)}
                >
                  {table.active ? 'Deactivate' : 'Activate'}
                </button>
                <button
                  disabled={busy}
                  className="text-button danger"
                  onClick={() => void rotate(table)}
                >
                  Replace QR
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="panel management-list">
          {data?.map((entry) => (
            <div className="management-row" key={entry.id}>
              <span className="sort-number">
                {String((entry as Category).sortOrder).padStart(2, '0')}
              </span>
              <div className="management-name">
                <strong>{entry.name}</strong>
                {'categoryId' in entry && (
                  <small>
                    {
                      categories.data?.find((c) => c.id === entry.categoryId)
                        ?.name
                    }{' '}
                    · {money(entry.price)}
                  </small>
                )}
              </div>
              {'available' in entry && (
                <label className="toggle">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={entry.available}
                    onChange={() =>
                      void save({ available: !entry.available }, entry.id)
                    }
                  />
                  {entry.available ? 'Available' : 'Sold out'}
                </label>
              )}
              <Status value={entry.active ? 'ACTIVE' : 'ARCHIVED'} />
              <button onClick={() => setEditing(entry)}>Edit</button>
            </div>
          ))}
          {!data?.length && <p>No {kind} yet. Add the first one above.</p>}
        </section>
      )}
      {editing !== undefined && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-title"
          >
            <div className="row">
              <h2 id="edit-title">
                {editing ? 'Edit' : 'Add'}{' '}
                {kind === 'menu'
                  ? 'menu item'
                  : kind === 'tables'
                    ? 'table'
                    : 'category'}
              </h2>
              <button
                disabled={busy}
                aria-label="Close form"
                onClick={() => setEditing(undefined)}
              >
                ×
              </button>
            </div>
            <form
              key={editing?.id || 'new'}
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const body: Record<string, unknown> = { name: fd.get('name') };
                if (kind !== 'tables') {
                  body.sortOrder = Number(fd.get('sortOrder'));
                  body.active = fd.get('active') === 'on';
                } else if (editing) body.active = fd.get('active') === 'on';
                if (kind === 'menu') {
                  Object.assign(body, {
                    price: fd.get('price'),
                    categoryId: fd.get('categoryId'),
                    description: fd.get('description') || null,
                    imageUrl: fd.get('imageUrl') || null,
                    available: fd.get('available') === 'on',
                  });
                }
                void save(body, editing?.id);
              }}
            >
              <label>
                Name
                <input
                  name="name"
                  defaultValue={editing?.name}
                  required
                  maxLength={100}
                  autoFocus
                />
              </label>
              {kind !== 'tables' && (
                <>
                  <label>
                    Display order
                    <input
                      type="number"
                      name="sortOrder"
                      defaultValue={(editing as Category)?.sortOrder || 0}
                      min={0}
                      max={9999}
                      required
                    />
                  </label>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      name="active"
                      defaultChecked={editing?.active ?? true}
                    />{' '}
                    Active · shown in menu
                  </label>
                </>
              )}
              {kind === 'tables' && editing && (
                <label className="checkbox">
                  <input
                    name="active"
                    type="checkbox"
                    defaultChecked={editing.active}
                  />{' '}
                  Table active
                </label>
              )}
              {kind === 'menu' && (
                <>
                  <label>
                    Category
                    <select
                      name="categoryId"
                      defaultValue={(editing as MenuItem)?.categoryId}
                      required
                    >
                      <option value="">Choose category</option>
                      {categories.data?.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {!c.active ? ' (archived)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Price in baht
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="999999.99"
                      name="price"
                      defaultValue={(editing as MenuItem)?.price}
                      required
                    />
                  </label>
                  <label>
                    Description
                    <textarea
                      name="description"
                      maxLength={500}
                      defaultValue={(editing as MenuItem)?.description || ''}
                    />
                  </label>
                  <label>
                    Image URL · optional
                    <input
                      type="url"
                      name="imageUrl"
                      placeholder="https://…"
                      defaultValue={(editing as MenuItem)?.imageUrl || ''}
                    />
                  </label>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      name="available"
                      defaultChecked={(editing as MenuItem)?.available ?? true}
                    />{' '}
                    Available tonight
                  </label>
                </>
              )}
              <ErrorNotice error={error} />
              <Action type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save changes'}
              </Action>
              {editing && kind !== 'tables' && (
                <p className="muted">
                  To remove from the menu, turn off Active. Historical orders
                  remain intact.
                </p>
              )}
            </form>
          </section>
        </div>
      )}
      {qr && (
        <div className="modal-backdrop qr-modal">
          <section
            className="modal print-card"
            role="dialog"
            aria-modal="true"
            aria-label={`QR for table ${qr.name}`}
          >
            <div className="eyebrow">ORDERING / POC</div>
            <h1>TABLE {qr.name}</h1>
            <h2>Scan. Order. Enjoy.</h2>
            <img
              src={`/api/admin/tables/${qr.id}/qr?v=${qr.qrToken}`}
              alt={`Scan to order at table ${qr.name}`}
            />
            <p>สแกนเพื่อสั่งอาหารและเครื่องดื่ม</p>
            <p>Scan with your phone camera to order drinks and food.</p>
            <div className="row no-print">
              <a
                className="button"
                href={`/api/admin/tables/${qr.id}/qr?v=${qr.qrToken}`}
                download={`table-${qr.name}.svg`}
              >
                Download QR
              </a>
              <Action onClick={() => window.print()}>Print</Action>
              <button onClick={() => setQr(null)}>Close</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

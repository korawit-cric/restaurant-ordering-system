'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { orderingApi, type Preset } from '@repo/api-client';
import { clientFetch } from '../../lib/fetch/client';
import { Action, ErrorNotice } from '../../components/shared';
export default function Signup() {
  const router = useRouter(),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(''),
    [slug, setSlug] = useState(''),
    [preset, setPreset] = useState<Preset>('BAR_FLEXIBLE');
  return (
    <main className="login">
      <Link href="/" className="wordmark">
        ORDERLY
      </Link>
      <div className="eyebrow">SELF-SETUP</div>
      <h1>Create your restaurant.</h1>
      <p>
        Start with one branch and a 30-day trial. No special hardware required.
      </p>
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const f = new FormData(e.currentTarget);
          void clientFetch(
            orderingApi.signup({
              name,
              slug,
              branchName: f.get('branchName'),
              preset,
              email: f.get('email'),
              password: f.get('password'),
            }),
          )
            .then(() => router.replace('/admin/onboarding'))
            .catch(setError)
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Restaurant name
          <input
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSlug(
                e.target.value
                  .toLowerCase()
                  .normalize('NFKD')
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/^-|-$/g, ''),
              );
            }}
            placeholder="My Bar"
          />
        </label>
        <label>
          Public slug
          <input
            required
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            minLength={3}
          />
        </label>
        <label>
          Branch name
          <input name="branchName" required defaultValue="Main branch" />
        </label>
        <label>
          Service style
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value as Preset)}
          >
            <option value="BAR_FLEXIBLE">Bar / flexible seating</option>
            <option value="TABLE_SERVICE">Table service</option>
            <option value="QUICK_SERVICE">Quick service</option>
            <option value="PICKUP_STALL">Pickup / food stall</option>
          </select>
        </label>
        <label>
          Your email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Password (12+ characters)
          <input
            name="password"
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
          />
        </label>
        <ErrorNotice error={error} />
        <Action type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create restaurant →'}
        </Action>
      </form>
      <p>
        Already registered? <Link href="/staff/login">Sign in</Link>
      </p>
    </main>
  );
}

'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { orderingApi } from '@repo/api-client';
import { clientFetch } from '../../../lib/fetch/client';
import { Action, ErrorNotice } from '../../../components/shared';
export default function Login() {
  const router = useRouter();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <Link href="/" className="wordmark">
        ORDERING / POC
      </Link>
      <div className="eyebrow">BEHIND THE BAR</div>
      <h1>Ready for service.</h1>
      <p>Sign in to manage orders and payments.</p>
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const form = new FormData(e.currentTarget);
          void (async () => {
            try {
              await clientFetch(
                orderingApi.login(
                  form.get('email') as string,
                  form.get('password') as string,
                ),
              );
              router.replace('/staff/orders');
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        <ErrorNotice error={error} />
        <Action disabled={busy} type="submit">
          {busy ? 'Signing in…' : 'Sign in →'}
        </Action>
      </form>
      <p className="muted">Staff and admin access only.</p>
    </main>
  );
}

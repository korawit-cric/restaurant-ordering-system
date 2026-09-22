'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { orderingApi } from '@repo/api-client';
import { clientFetch } from '../../../lib/fetch/client';
import { Action, ErrorNotice } from '../../../components/shared';
export default function Login() {
  const router = useRouter(),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <Link href="/" className="wordmark">
        ORDERLY
      </Link>
      <div className="eyebrow">STAFF ACCESS</div>
      <h1>Ready for service.</h1>
      <p>Sign in to manage orders, sessions, and payments.</p>
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const f = new FormData(e.currentTarget);
          void clientFetch(
            orderingApi.login(
              f.get('email') as string,
              f.get('password') as string,
            ),
          )
            .then((u) =>
              router.replace(
                u.platformRole === 'OPERATOR' && !u.branchId
                  ? '/platform'
                  : '/staff/orders',
              ),
            )
            .catch(setError)
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Email
          <input name="email" type="email" required autoComplete="username" />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        </label>
        <ErrorNotice error={error} />
        <Action type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in →'}
        </Action>
      </form>
      <p>
        <Link href="/signup">Create a restaurant</Link>
      </p>
    </main>
  );
}

'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { orderingApi } from '@repo/api-client';
import { clientFetch } from '../lib/fetch/client';
import { Action, ErrorNotice } from './shared';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <main className="login">
      <Link href="/" className="wordmark">
        ORDERLY
      </Link>
      <h1>Reset your password</h1>
      <p>
        Enter your staff email address. We will send a link if it has an
        account.
      </p>
      <form
        className="panel"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          void clientFetch(orderingApi.requestPasswordReset(email))
            .then(() => setSent(true))
            .catch(setError)
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="email"
          />
        </label>
        <ErrorNotice error={error} />
        {sent && (
          <p>
            Check your inbox. If this address has an account, a reset link is on
            its way.
          </p>
        )}
        <Action type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Send reset link'}
        </Action>
      </form>
      <Link href="/staff/login">Back to sign in</Link>
    </main>
  );
}

export function ResetPassword({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <main className="login">
      <Link href="/" className="wordmark">
        ORDERLY
      </Link>
      <h1>Choose a new password</h1>
      {!token ? (
        <p>This reset link is incomplete.</p>
      ) : done ? (
        <p>
          Password changed. All previous sessions were signed out.{' '}
          <Link href="/staff/login">Sign in</Link> with the new password.
        </p>
      ) : (
        <form
          className="panel"
          onSubmit={(event) => {
            event.preventDefault();
            if (password !== confirmation) {
              setError('Passwords do not match');
              return;
            }
            setBusy(true);
            setError(null);
            void clientFetch(orderingApi.resetPassword(token, password))
              .then(() => setDone(true))
              .catch(setError)
              .finally(() => setBusy(false));
          }}
        >
          <label>
            New password
            <input
              type="password"
              minLength={12}
              maxLength={256}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete="new-password"
            />
          </label>
          <label>
            Confirm password
            <input
              type="password"
              minLength={12}
              maxLength={256}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              required
              autoComplete="new-password"
            />
          </label>
          <ErrorNotice error={error} />
          <Action type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Change password'}
          </Action>
        </form>
      )}
      <Link href="/staff/login">Back to sign in</Link>
    </main>
  );
}

export function AcceptInvitation({ token }: { token: string }) {
  const invite = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => clientFetch(orderingApi.invitation(token)),
    enabled: !!token,
    retry: false,
  });
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <main className="login">
      <Link href="/" className="wordmark">
        ORDERLY
      </Link>
      <h1>Join the team</h1>
      <ErrorNotice error={invite.error || error} />
      {!token && <p>This invitation link is incomplete.</p>}
      {invite.isPending && token && <p>Checking invitation…</p>}
      {done && (
        <p>
          Invitation accepted. <Link href="/staff/login">Sign in</Link> to start
          using the staff dashboard.
        </p>
      )}
      {invite.data && !done && (
        <form
          className="panel"
          onSubmit={(event) => {
            event.preventDefault();
            if (invite.data.needsPassword && password !== confirmation) {
              setError('Passwords do not match');
              return;
            }
            setBusy(true);
            setError(null);
            void clientFetch(
              orderingApi.acceptInvitation(
                token,
                invite.data.needsPassword ? password : undefined,
              ),
            )
              .then(() => setDone(true))
              .catch(setError)
              .finally(() => setBusy(false));
          }}
        >
          <p>
            <strong>{invite.data.restaurant}</strong> invited{' '}
            {invite.data.email} to {invite.data.branch} as{' '}
            {invite.data.role.toLowerCase()}.
          </p>
          {invite.data.needsPassword ? (
            <>
              <label>
                Password
                <input
                  type="password"
                  minLength={12}
                  maxLength={256}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  autoComplete="new-password"
                />
              </label>
              <label>
                Confirm password
                <input
                  type="password"
                  minLength={12}
                  maxLength={256}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  required
                  autoComplete="new-password"
                />
              </label>
            </>
          ) : (
            <p>Your existing Orderly password will continue to work.</p>
          )}
          <ErrorNotice error={error} />
          <Action type="submit" disabled={busy}>
            {busy ? 'Accepting…' : 'Accept invitation'}
          </Action>
        </form>
      )}
    </main>
  );
}

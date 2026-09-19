'use client';
import { Button } from '@repo/ui/button';
import type { ReactNode } from 'react';
export function Action({
  children,
  onClick,
  disabled = false,
  type = 'button',
  secondary = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  secondary?: boolean;
}) {
  return (
    <Button
      className={`action ${secondary ? 'secondary' : 'primary'}`}
      type={type}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
export function money(value: string | number) {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value));
}
export function ErrorNotice({ error }: { error: unknown }) {
  return error ? (
    <div role="alert" className="error">
      {error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Something went wrong. Please try again.'}
    </div>
  ) : null;
}
export function Status({ value }: { value: string }) {
  return (
    <span className={`badge ${value.toLowerCase()}`}>
      {value.replaceAll('_', ' ')}
    </span>
  );
}

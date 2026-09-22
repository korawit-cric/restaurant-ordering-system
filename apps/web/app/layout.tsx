import type { Metadata } from 'next';
import { QueryProvider } from '../lib/query';
import '@repo/ui/styles.css';
import './globals.css';
export const metadata: Metadata = {
  title: 'Orderly · QR ordering for small restaurants',
  description:
    'Simple QR ordering and live staff dashboard for small restaurants, bars, cafés, and stalls.',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}

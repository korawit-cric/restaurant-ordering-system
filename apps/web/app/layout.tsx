import type { Metadata } from 'next';
import { QueryProvider } from '../lib/query';
import '@repo/ui/styles.css';
import './globals.css';
export const metadata: Metadata = {
  title: 'Restaurant Ordering · POC',
  description: 'Scan. Order. Enjoy. Independent table orders for a Thai bar.',
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

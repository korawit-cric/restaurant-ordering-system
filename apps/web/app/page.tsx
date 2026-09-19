import Link from 'next/link';
export default function Home() {
  return (
    <main className="landing">
      <div className="wordmark">
        <span className="brand-icon">↗</span> ORDERING / POC
      </div>
      <div className="eyebrow">A GOOD NIGHT STARTS HERE</div>
      <h1>
        Less waiting.
        <br />
        <em>Another round.</em>
      </h1>
      <p>
        Scan the QR at your table, pick your favourites, and order. Every round
        has its own payment.
      </p>
      <div className="panel">
        <h2>Already at a table?</h2>
        <p>
          Use your phone camera to scan the QR on your table. Your menu will
          open automatically.
        </p>
      </div>
      <Link className="button primary" href="/staff/login">
        Staff sign in <span>↗</span>
      </Link>
      <footer>MADE FOR SMALL BARS · THAILAND</footer>
    </main>
  );
}

import Link from 'next/link';
export default function Home() {
  return (
    <main className="landing">
      <div className="wordmark">
        <span className="brand-icon">↗</span> ORDERLY
      </div>
      <div className="eyebrow">LIGHTWEIGHT RESTAURANT ORDERING</div>
      <h1>
        Scan. Order.
        <br />
        <em>Keep service moving.</em>
      </h1>
      <p>
        Self-setup QR ordering for restaurants, bars, cafés, and food stalls.
        Run it on the phones, tablets, and browsers you already own.
      </p>
      <div className="panel">
        <h2>Your restaurant, ready in minutes.</h2>
        <p>
          Create a restaurant, choose your service style, add your menu, print
          QR codes, and open the live staff board.
        </p>
      </div>
      <div className="row">
        <Link className="button primary" href="/signup">
          Create restaurant →
        </Link>
        <Link className="button secondary" href="/staff/login">
          Sign in
        </Link>
      </div>
      <footer>ONE SHARED PLATFORM · MADE FOR SMALL TEAMS</footer>
    </main>
  );
}

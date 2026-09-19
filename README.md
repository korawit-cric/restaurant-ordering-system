# Restaurant Ordering System POC

A single-location QR ordering system for a small Thai bar. Built from the Monex Turborepo template with Next.js, NestJS, Prisma and PostgreSQL.

Each table has many independent orders. There is no open table bill, customer account, inventory system or automatic payment verification.

## Run locally

Requires Node.js 22.12+, npm and Docker Compose v2 (or PostgreSQL).

```sh
npm ci
cp .env.example .env # only if .env was not created by npm
```

Edit `.env`: set `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` of at least 12 characters. Optionally set `STAFF_EMAIL` and `STAFF_PASSWORD` for an operational account. Seed never overwrites existing account passwords.

```sh
npm run env:distribute
npm run db:start
npm run db:deploy
npm run build
npm run db:seed
npm run dev
```

Open <http://localhost:3010/staff/login>. In **Tables**, open a table menu or print/download its QR. Customers enter through `/t/<random-token>`. The API runs on port 3011 and the local database on port 5444. These ports are separate from the source template defaults.

`APP_ORIGIN` must exactly match the browser origin, including scheme and port. When testing on phones, use an HTTPS origin reachable by the phones and regenerate/reprint QR images with that origin. The opaque table tokens themselves remain stable.

Seeded sample prices are demonstration values, not the restaurant's confirmed prices. Review them before service. The menu includes Leo, Chang, Singha, Regency, Coke, Coke Zero, soda, water, fries and fried chicken.

## Payments and operational rules

- Every order gets one payment, initially `PENDING`. Cash and QR orders immediately appear on the staff dashboard.
- QR payment is manual. Set `PROMPTPAY_QR_URL` to a restaurant-provided HTTPS image URL or a same-origin path such as `/promptpay.png`, and set `PAYMENT_RECIPIENT`. A same-origin image belongs in `apps/web/public` before building. QR payment is disabled when no image is configured. Check the recipient and actual bank receipt before confirming. There is no simulated verification.
- Staff can accept, prepare and serve independently of payment. Served-but-unpaid orders stay on the active board.
- Only staff can confirm receipt. A confirmation is idempotent and records the confirming user's ID and payment time.
- Cancellation requires confirmation and is allowed only before serving and before payment. Paid orders cannot be cancelled: refunds require a later explicit workflow. Staff cannot edit submitted items.
- Menu/category deletion is archival (`active=false`). Temporarily sold-out items use `available=false`. Historical names, unit prices, line totals and table names remain unchanged.
- Customers can check the status of a specific order from their confirmation link and immediately place another independent order.
- Daily sales count confirmed payments by `paidAt` in Asia/Bangkok. Today's order count excludes cancelled orders and uses order creation date. These are deliberately separate measures.

## Structure

- `apps/web`: Next.js App Router customer, staff and admin screens; frontend-owned fetching and TanStack Query.
- `apps/api`: NestJS authentication, validation, ordering transactions, operations, management and SSE.
- `apps/db`: local PostgreSQL Compose service.
- `packages/prisma`: schema, SQL migration, seed and shared client/types.
- `packages/api-client`: typed endpoint contracts, with no fetch implementation.
- `packages/ui`, `design-system`, `icons`: shared template components and styles.
- Shared TypeScript, ESLint and Jest configuration stays in the existing packages.

## Correctness and security

Prices and totals are calculated on the server with Prisma Decimal / PostgreSQL numeric columns. The customer's expected unit price is used only to reject stale pricing, never to calculate amounts. The server validates active tables, active categories/products, availability, unique lines and integer quantities (1–30 per product, at most 40 lines).

Order/items/payment creation uses one serializable transaction. A unique request key plus payload fingerprint recovers duplicate submissions and rejects key reuse with different contents. The browser persists the exact pending request before transmission and locks it across uncertain network failures and reloads. Price/availability rejections require reviewing the refreshed menu.

Payment and cancellation operations lock the same order row so conflicting staff actions cannot leave a cancelled/paid order. All operational state is in PostgreSQL. SSE only announces changes: refresh, reconnection and 15-second polling reload authoritative state. New-event alerts require a staff interaction to enable sound; old orders and reconnect snapshots are silent. Live events run in one NestJS instance; keep one API replica for this MVP. Streams reconnect at least once per minute to revalidate authentication.

Staff credentials use salted scrypt hashes. Database-backed sessions use random opaque cookies, HttpOnly, SameSite=Strict, 12-hour expiry and Secure in production. Admin routes enforce ADMIN separately from STAFF. Write requests require the configured origin and JSON content type. Basic bounded in-process request limiting is intentionally conservative behind a reverse proxy. API responses use no-store. Table tokens grant no staff/admin access and cannot list order history.

## Tests

```sh
npm run build
npm run lint
npm run check-types
npm test
```

For database integration tests, create a **disposable** PostgreSQL database whose name ends in `_test`. The test suite clears its domain tables.

```sh
DATABASE_URL=postgresql://postgres:postgres@localhost:5444/ordering_test npm run db:deploy
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5444/ordering_test npm run test:integration
npx playwright install chromium
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5444/ordering_test npm run test:e2e
```

Browser tests start the built API and web app on 3011/3010, exercise mobile ordering with a lost response and reload-safe retry, staff fulfillment, sold-out controls and printable table QR. Keep those ports free. Screenshots are written to `artifacts/`; browser recordings and traces go to `test-results/`. Test users use freshly generated passwords. CI runs build, lint, typechecks, unit tests, migrations and database integration tests against PostgreSQL 16.

## Production deployment

A single host can run the supplied Docker Compose stack: PostgreSQL 16, one NestJS API, Next.js, and Caddy for HTTPS. No Redis or message broker is required.

1. Point a domain's DNS to the host and allow inbound ports 80/443.
2. Copy `.env.example` to `.env` and set strong credentials. Set `PUBLIC_HOST=order.your-domain.com`, `APP_ORIGIN=https://order.your-domain.com`, and `PRODUCTION_DATABASE_URL=postgresql://postgres:URL_ENCODED_PASSWORD@postgres:5432/restaurant_ordering`. Keep DB_USER/DB_PASSWORD/DB_NAME consistent with that URL. Configure the payment QR and recipient.
3. Build and start:

   ```sh
   docker compose -f compose.production.yml up -d --build
   docker compose -f compose.production.yml exec api npm run db:seed
   ```

The migration job must succeed before the API starts. Only Caddy exposes public ports. Caddy forwards `/api/*` directly to NestJS with immediate flushing for SSE. Cookie authentication therefore stays same-origin. The image contains no `.env` secrets. The runtime uses the unprivileged `node` user.

Back up the PostgreSQL volume regularly and test restoration. Before service, verify HTTPS login, real table QR scanning from a phone, the bank recipient, manual payment confirmation and staff notification sound on the intended tablet. The Docker production stack is supplied for deployment; building the application locally is not evidence of a deployed production service.

## Deliberate limits

One location, one API process, manual payment confirmation, no refunds, no staff order editing, no tax receipts, no printer integration, no inventory, and no offline ordering. Additional accounts can be provisioned through seed environment variables with new email addresses; account-management UI is outside this MVP. Menus refresh every 10 seconds, and order creation always rechecks availability. Optional image URLs do not require an upload service.

## Dependency maintenance

The template's compatible framework updates are locked in `package-lock.json`. Root npm overrides select patched versions of multer, deepmerge-ts, mysql2 and ajv while retaining the existing framework majors. Recheck these overrides when upgrading their parent packages, and run build plus database integration tests after dependency changes.

## Verified workflow screenshots

Captured from the end-to-end test with disposable sample data:

- [Customer mobile menu](artifacts/customer-menu.png)
- [Live staff dashboard](artifacts/staff-dashboard.png)
- [Printable table QR](artifacts/table-qr.png)

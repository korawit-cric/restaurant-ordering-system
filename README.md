# Restaurant Ordering System POC · Orderly

**Repository description:** Self-setup, multi-tenant QR ordering SaaS for small restaurants, bars, cafés, and food stalls—built with Next.js, NestJS, Prisma, PostgreSQL, and Turborepo.

Orderly lets a business register, choose a service workflow, add a menu and locations, print QR codes, and run a live order board on existing devices. It is intentionally lighter than a POS. Customers need only a browser and a valid QR. Cash and PromptPay are tracked separately from preparation status; PromptPay receipts are confirmed by staff, never assumed paid.

## Local setup

Requires Node.js 22.12+, npm, and PostgreSQL. Docker Compose can provide the local database.

```sh
npm ci
cp .env.example .env # only if npm did not create .env
npm run env:distribute
npm run db:start
npm run db:deploy
npm run build
npm run dev
```

Open `http://localhost:3010/signup` and register a restaurant. Onboarding guides you through categories, products, service points, QR printing, and a first test order. The web app listens on 3010, NestJS on 3011, and the local PostgreSQL Compose service on 5444. `APP_ORIGIN` must match the browser origin exactly. For phone testing, use an HTTPS origin reachable from the phone and print QR codes from that origin.

Migrations seed two _plan definitions_ (`starter`: one branch, `standard`: two branches) without seeding a default restaurant or password. New restaurants begin on a 30-day trial representation. Prices and subscription collection are business decisions, not implemented as automatic billing. To add a platform operator, set `PLATFORM_ADMIN_EMAIL` and `PLATFORM_ADMIN_PASSWORD` (12+ characters) and run `npm run db:seed`; restaurant owners sign up themselves. The seed does not overwrite an existing password.

## Workflows

| Preset                 | QR                | Session      | Payment     | Fulfillment       |
| ---------------------- | ----------------- | ------------ | ----------- | ----------------- |
| Table Service          | Permanent         | Open session | At checkout | Serve to location |
| Bar / Flexible Seating | Temporary session | Open session | Per order   | Serve to location |
| Quick Service          | Permanent         | Single order | Per order   | Pickup            |
| Pickup / Food Stall    | Permanent         | Single order | Per order   | Pickup            |

Owners and managers can change branch settings later. A permanent QR belongs to a ServicePoint, such as a table, bar seat, counter, or pickup spot. A temporary QR belongs to an OrderSession and stops accepting orders when it closes. Moving an active session to another ServicePoint keeps its token valid. Open sessions support repeated orders; a single-order session closes after its first order. For at-checkout branches, staff closes the session with a chosen payment method and confirms payment afterward.

Print from the browser in A4 or compact 80 mm format, save a PDF through the browser print dialog, or download a PNG. Automatic printer control is outside v1.

## Correctness and isolation

PostgreSQL uses shared tables with `tenantId` and `branchId`; composite foreign keys enforce matching branch/tenant relationships. Restaurant APIs derive their scope from an authenticated `BranchUser` membership on every request. A known ID from another tenant cannot be read or changed. Staff roles are OWNER, MANAGER, and STAFF; the platform OPERATOR role is separate. Staff/admin APIs never accept a frontend tenant ID as authority.

The server validates active QR destinations, products, categories, menus, quantities, availability, and expected prices. It computes totals with Prisma Decimal and PostgreSQL numeric columns. Order items preserve name, unit price, quantity, note, and line total snapshots. An order and its items are written in a serializable transaction. A unique tenant-scoped idempotency key returns the original order on double taps or network retries; the browser persists the exact pending request before sending it. Product availability is rechecked at submission even if a menu page is stale.

Payment and fulfillment state machines are separate. For per-order payment, CASH or amount-specific PROMPTPAY remains PENDING until staff confirms receipt. For at-checkout branches, orders contribute to a session subtotal and payment is confirmed once on the closed session. PromptPay QR payloads are generated from a branch's configured recipient ID and the server-calculated amount. **There is no automatic bank verification.** Staff should confirm the actual receipt before pressing the confirmation button. Paid orders cannot be cancelled through the v1 UI; refund handling is external.

SSE announces new/changed orders to a branch-scoped staff stream. The board always reloads database state and polls every 15 seconds, so refresh and reconnection recover correctly. Browser sound requires an explicit staff interaction and only plays for genuinely new orders after the initial load. The supplied deployment runs one NestJS API replica; an event broker would be needed before scaling SSE across replicas.

Authenticated sessions use random HttpOnly, SameSite=Strict cookies with 12-hour expiry and Secure in production. Write requests require the configured origin and JSON content type. QR tokens grant public ordering only, not staff access.

## Structure

- `apps/web`: Next.js App Router, mobile customer flow, setup, staff board, and operator overview. TanStack Query owns client server state.
- `apps/api`: NestJS public/customer, restaurant, and platform routes; validation, transactions, membership checks, payment instructions, and SSE.
- `packages/prisma`: shared schema, SQL migrations, Prisma client, and optional operator seed.
- `packages/api-client`: runtime-agnostic typed endpoint contracts.
- `packages/ui`, `design-system`, `icons`: existing shared template design assets.
- `apps/db`: local PostgreSQL Compose service.

The `202609220001_multi_tenant` migration preserves a deployed single-restaurant POC's users, menu, table QR tokens, orders, item snapshots, and payment states in one starter tenant/branch. Back up production data and test the migration on a restored copy before applying it live. The former `SERVED` state maps to `COMPLETED`, and former QR payment maps to PROMPTPAY.

## Tests

```sh
npm run build
npm run lint
npm run check-types
npm test
```

The integration suite **clears all domain tables** in the target database. Use only a disposable PostgreSQL database whose name ends in `_test`:

```sh
DATABASE_URL=postgresql://postgres:postgres@localhost:5444/ordering_test npm run db:deploy
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5444/ordering_test npm run test:integration
npx playwright install chromium
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5444/ordering_test npm run test:e2e
```

Integration checks cover tenant isolation, permission boundaries, branch limits, concurrent duplicate submissions, stale prices, sold-out products, snapshots, payment/status transitions, permanent and temporary QR behavior, session closure, and checkout totals. Browser tests exercise signup, mobile order recovery, staff fulfillment, sold-out propagation, and QR printing. Screenshots are written to `artifacts/`.

## Production deployment

The supplied Docker Compose stack runs PostgreSQL 16, one NestJS API, Next.js, and Caddy for HTTPS. No Redis, specialized POS hardware, or native apps are required.

1. Point DNS at the host and allow ports 80/443.
2. Set a strong database password and consistent `DB_*` values in `.env`. Set `PUBLIC_HOST`, `APP_ORIGIN=https://<host>`, and `PRODUCTION_DATABASE_URL` using the Compose hostname `postgres` and a URL-encoded password.
3. Run `docker compose -f compose.production.yml up -d --build`. The migration job completes before the API starts.
4. Optionally run `docker compose -f compose.production.yml exec api npm run db:seed` after configuring a platform operator.
5. Register a restaurant through `/signup`, configure its branch PromptPay ID if accepting PromptPay, verify the bank recipient, and print QR codes from the production domain.

Back up and restore PostgreSQL regularly. Verify HTTPS, staff login, physical QR scans, network retry recovery, manual payment confirmation, and dashboard sound on the intended devices before live service. The repository contains a deployment stack, but deployment and payment-provider onboarding remain operator responsibilities.

## Deliberate v1 limits

Automatic subscription billing, automatic PromptPay verification, refund processing, password reset/email invitations, tax receipts, stock accounting, native apps, automatic thermal printing, offline sync, and multiple API replicas are not included. Owners can provision staff with an initial password and pass it to them directly; managed invitations can be added later. The platform operator view is intentionally small. A single branch's reports show today's order count, confirmed cash/PromptPay sales, recent daily sales, and top products.

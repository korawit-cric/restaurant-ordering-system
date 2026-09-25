# Restaurant Ordering System POC · Orderly

**Repository description:** Self-setup, multi-tenant QR ordering SaaS for small restaurants, bars, cafés, and food stalls—built with Next.js, NestJS, Prisma, PostgreSQL, and Turborepo.

Orderly lets a business register, choose a service workflow, add a menu and locations, print QR codes, and run a live order board on existing devices. It is intentionally lighter than a POS. Customers need only a browser and a valid QR. Cash and PromptPay are tracked separately from preparation status; PromptPay receipts are confirmed by staff, never assumed paid.

## How it works

1. **Set up the restaurant.** An owner signs up at `/signup`, creates a branch, and chooses a preset. The setup guide then leads them through categories, products, service points (tables, bar seats, counters, or pickup spots), and QR printing.
2. **Scan and order.** A permanent service-point QR opens `/q/<token>`; a temporary session QR opens `/s/<token>`. The customer sees that branch's available menu, adjusts quantities, adds notes, reviews the total, and submits without an account. A valid QR identifies the destination; customers never enter a table number.
3. **Pay according to the branch workflow.** A branch can take payment per order, collect one payment when an open session closes, or handle payment outside Orderly. Cash and PromptPay remain pending until staff confirms receipt. PromptPay shows an amount-specific QR when a recipient ID is configured. A customer can submit a “payment sent” notice, but staff must match the deposit in the receiving bank app and record its transaction reference before Orderly marks it paid.
4. **Serve and repeat.** The order appears on `/staff/orders` with its location, items, payment state, and preparation state. Staff can accept it, prepare it, mark it ready or complete, and confirm payment separately. An open session can receive more orders through the same QR; a closed temporary session cannot.

```mermaid
flowchart LR
    A[Owner sets up branch, menu, and QR] --> B[Customer scans QR and submits order]
    B --> C[(PostgreSQL order and item snapshots)]
    C --> D[Staff dashboard receives update]
    D --> E[Staff confirms payment and fulfills order]
    E --> F{Open session?}
    F -- Yes --> B
    F -- No --> G[Finished]
```

### Screenshots

These browser-test screenshots use sample restaurant data. The QR pictured below points to `localhost`, so generate and print fresh QR codes from the deployed HTTPS domain for real customers.

<img src="artifacts/customer-menu.png" alt="Mobile customer menu showing table A7, a Leo quantity selector, and a sticky View order button" width="320" />

_The mobile menu keeps the location, quantities, and cart total visible._

<img src="artifacts/staff-dashboard.png" alt="Staff live orders dashboard showing an A7 order, cash pending state, and fulfillment controls" width="900" />

_The live board gives the location and next staff actions visual priority._

<img src="artifacts/location-qr.png" alt="Printable service-point QR dialog for A7 with print and PNG download controls" width="720" />

_A service-point QR can be printed in A4 or compact format, or downloaded as a PNG._

## Design behind it

**Service points describe fulfillment, not just tables.** A branch can use a table, bar seat, standing zone, counter, or pickup point. A permanent QR belongs to a service point. A temporary QR belongs to an `OrderSession`, which can be moved to another service point without changing the customer's link. Each `Order` remains a separate record; an open session groups repeat orders only when the selected workflow needs it.

**Presets keep setup short.** Four presets combine QR, session, payment, and fulfillment modes. Owners can adjust those settings later, while the customer flow stays scan → menu → cart → order. The [workflow matrix](#workflows) shows each preset.

**Tenant boundaries are enforced in the API and database.** Restaurants share one PostgreSQL database, but business records carry tenant and branch scope. Authenticated staff requests derive that scope from membership, and composite relationships prevent orders, products, sessions, or service points from crossing branches. Public QR tokens grant only customer ordering access.

**PostgreSQL is the source of truth.** The NestJS API validates the QR, availability, quantities, and current prices before calculating totals with decimal money values. It stores product names and prices on order items so old orders survive menu changes. Transactions and idempotency keys protect order submission from partial writes and double taps. The staff board uses branch-scoped SSE for prompt updates, then reloads persisted state after refresh or connection loss.

```mermaid
flowchart LR
    Customer[Customer browser] --> Web[Next.js web app]
    Staff[Staff / owner browser] --> Web
    Web --> API[NestJS API]
    API --> DB[(PostgreSQL via Prisma)]
    API -- Branch-scoped SSE --> Staff
```

The monorepo keeps the Next.js interface, NestJS business rules, shared typed API contracts, and Prisma schema in separate packages. It deploys as one web app, one API replica, and PostgreSQL; browser printing and existing devices are enough for v1. The sections below cover [local setup](#local-setup), [correctness](#correctness-and-isolation), and [production deployment](#production-deployment).

See the [system architecture reference](docs/ARCHITECTURE.md) for the complete entity relationship diagram, internal and external service maps, security boundaries, order and payment sequences, and deployment topology. The [payment architecture guide](docs/PAYMENTS.md) documents the current cash, PromptPay, payment-claim, and refund behavior plus manual, slip-assisted, direct-bank, and gateway improvement paths.

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

Password reset and staff email invitations require a verified sender domain plus `RESEND_API_KEY` and `EMAIL_FROM`; see the [account and operations setup guide](docs/OPERATIONS_SETUP.md). Without email delivery, existing logins continue to work but reset and invitation requests are unavailable.

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

Payment and fulfillment state machines are separate. For per-order payment, CASH or amount-specific PROMPTPAY remains PENDING until staff confirms receipt. For at-checkout branches, orders contribute to a session subtotal and payment is confirmed once on the closed session. PromptPay QR payloads are generated from a branch's configured recipient ID and the server-calculated amount. **There is no automatic bank verification.** Customer payment claims are only review signals. Staff must check the receiving account and enter its bank transaction reference. Paid orders keep their paid history; manual cash or bank-transfer refunds are requested and completed separately from the order detail page, with over-refunds blocked.

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

Automatic subscription billing, automatic PromptPay verification, automatic refund transfers, tax receipts, stock accounting, native apps, automatic thermal printing, offline sync, and multiple API replicas are not included. Manual PromptPay review and manual refund records are included. Password reset and email invitations are available after email delivery is configured. The [operations setup guide](docs/OPERATIONS_SETUP.md) explains the operating procedure and the provider, tax, and inventory decisions needed for the remaining features. The platform operator view is intentionally small. A single branch's reports show today's order count, confirmed cash/PromptPay sales, recent daily sales, and top products.

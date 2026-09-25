# System architecture

This document describes the current `develop` branch of Orderly, including the monorepo, runtime services, database model, security boundaries, and external integrations. In current-state diagrams, solid arrows are implemented and dashed arrows or boxes describe planned extension points. Proposed flows are explicitly labeled as target designs.

## Architecture at a glance

Orderly is a TypeScript Turborepo with a Next.js App Router frontend, a NestJS API, Prisma, and PostgreSQL. Customers use public opaque QR tokens. Restaurant and platform operations use authenticated browser sessions. All business state is stored in PostgreSQL; the browser and real-time channel are never the source of truth.

```mermaid
flowchart LR
  customer[Customer browser]
  staff[Staff and admin browser]
  operator[Platform operator browser]

  subgraph edge[Public edge]
    caddy[Caddy HTTPS reverse proxy]
  end

  subgraph application[Application containers]
    web[Next.js web\nport 3010]
    api[NestJS API\nport 3011]
    events[Branch-scoped SSE\nin-process]
  end

  subgraph data[Persistent data]
    postgres[(PostgreSQL 16)]
  end

  subgraph external[External services]
    resend[Resend email API]
    bank[Merchant bank API\nplanned]
  end

  customer -->|HTTPS| caddy
  staff -->|HTTPS| caddy
  operator -->|HTTPS| caddy
  caddy -->|pages and assets| web
  caddy -->|/api/*| api
  web -->|server requests through API_INTERNAL_URL| api
  api -->|Prisma queries and transactions| postgres
  api --> events
  events -->|/api/staff/events| staff
  api -->|password reset and invitations| resend
  api -.->|dynamic QR, callback, inquiry| bank
```

In local development, the browser opens Next.js on port `3010`. Next rewrites `/api/*` to NestJS on port `3011`. In the production Compose stack, Caddy terminates HTTPS and routes pages to Next.js and `/api/*` directly to NestJS. A one-shot migration container runs Prisma migrations before the API starts.

## Monorepo structure

```mermaid
flowchart TB
  root[restaurant-ordering-system-poc\nnpm workspaces and Turborepo]

  subgraph apps[Applications]
    web[apps/web\nNext.js App Router]
    api[apps/api\nNestJS REST and SSE]
    db[apps/db\nlocal PostgreSQL Compose]
  end

  subgraph domainPackages[Domain and runtime packages]
    client[packages/api-client\ntyped endpoint descriptors and DTO types]
    prisma[packages/prisma\nschema, migrations, seed, generated client]
    ui[packages/ui\nshared React controls and styles]
    icons[packages/icons\nSVG React components]
    design[packages/design-system\nshared design assets]
  end

  subgraph tooling[Shared tooling]
    ts[packages/typescript-config]
    eslint[packages/eslint-config]
    jest[packages/jest-config]
  end

  root --> web
  root --> api
  root --> db
  web --> client
  web --> ui
  web --> icons
  web --> design
  api --> prisma
  client --> ts
  prisma --> ts
  web --> ts
  api --> ts
  web --> eslint
  api --> eslint
  web --> jest
  api --> jest
```

The main responsibilities are:

- `apps/web`: customer menu and order status pages, staff dashboard, restaurant administration, onboarding, and platform administration.
- `apps/api`: authentication, tenant and branch authorization, public ordering, management APIs, payment review, refunds, reports, and SSE.
- `apps/db`: the developer PostgreSQL container definition.
- `packages/api-client`: runtime-agnostic endpoint descriptions and shared TypeScript response/request types. The frontend owns the actual server and browser fetch implementations.
- `packages/prisma`: the authoritative relational schema, migrations, seed data, and Prisma client export.
- `packages/ui`, `packages/icons`, and `packages/design-system`: shared presentation code.
- Shared TypeScript, ESLint, and Jest packages keep application configuration aligned.

Generated `dist`, `.next`, coverage, and Turbo cache directories are build artifacts rather than architectural modules.

## Frontend routes and API boundaries

```mermaid
flowchart LR
  subgraph browserRoutes[Next.js interfaces]
    publicUI[Customer\n/q/token or /s/token\n/t/token legacy alias]
    staffUI[Staff\n/staff/orders\n/staff/sessions\n/staff/history]
    adminUI[Restaurant admin\n/admin/*]
    platformUI[Platform operator\n/platform]
    accountUI[Account\n/signup and /staff login/recovery]
  end

  subgraph nestBoundaries[NestJS route boundaries]
    publicAPI["/public/:kind/:token<br/>no customer login"]
    authAPI["/auth<br/>signup, login, recovery, invitations"]
    staffAPI["/staff<br/>member session required"]
    restaurantAPI["/restaurant<br/>member plus role checks"]
    adminAPI["/admin<br/>member plus role checks"]
    platformAPI["/platform<br/>platform operator required"]
  end

  publicUI --> publicAPI
  staffUI --> staffAPI
  staffUI --> restaurantAPI
  adminUI --> adminAPI
  adminUI --> restaurantAPI
  platformUI --> platformAPI
  accountUI --> authAPI
```

A customer QR token grants access only to its public menu and related customer order operations. It is not staff authentication. Authenticated restaurant endpoints derive tenant and branch context from the server-side session and active `BranchUser` membership; they do not trust a browser-supplied `tenantId`.

## NestJS internal structure

```mermaid
flowchart TB
  request[HTTP request]
  boundary[BoundaryMiddleware\norigin, JSON content type, rate limits, security headers]
  errorFilter[PrismaFilter\nconsistent database errors]

  subgraph guards[Authentication and authorization]
    authGuard[AuthGuard\nsession cookie]
    memberGuard[MemberGuard\nactive tenant and branch membership]
    operatorGuard[OperatorGuard\nplatform role]
    roleCheck[requireRole\nOWNER, MANAGER, STAFF]
  end

  subgraph controllers[Controllers]
    auth[Auth and account controllers]
    customer[CustomerController]
    staff[StaffController]
    tenancy[TenancyController]
    admin[AdminController]
    platform[PlatformController]
  end

  subgraph services[Application services]
    authService[AuthService]
    emailService[EmailService]
    ordersService[OrdersService]
    paymentService[PaymentService]
    orderEvents[OrderEvents]
  end

  prismaService[PrismaService]
  database[(PostgreSQL)]

  request --> boundary
  boundary --> auth
  boundary --> customer
  boundary --> authGuard
  authGuard --> memberGuard
  authGuard --> operatorGuard
  memberGuard --> roleCheck
  memberGuard --> staff
  memberGuard --> tenancy
  memberGuard --> admin
  operatorGuard --> platform

  auth --> authService
  auth --> emailService
  customer --> ordersService
  customer --> paymentService
  staff --> ordersService
  staff --> paymentService
  staff --> orderEvents
  tenancy --> prismaService
  admin --> prismaService
  platform --> prismaService
  authService --> prismaService
  ordersService --> prismaService
  paymentService --> prismaService
  ordersService --> orderEvents
  prismaService --> database
  prismaService -. database error .-> errorFilter
```

`OrdersService` contains the critical transactional rules: QR/session validation, current product and availability checks, server-side Decimal price calculation, historical snapshots, idempotent order creation, state transitions, payment claims, manual confirmation, and refund limits. UI components display state and initiate commands; they do not calculate authoritative totals.

## Entity relationship diagram

The diagram shows persisted models. Most business-owned rows carry both `tenantId` and `branchId`. Composite relations and scoped queries enforce ownership at the application and database layers.

```mermaid
erDiagram
  USER {
    uuid id PK
    string email UK
    string passwordHash
    PlatformRole platformRole
    boolean active
  }
  AUTH_SESSION {
    string tokenHash PK
    uuid userId FK
    uuid tenantId
    uuid branchId
    datetime expiresAt
  }
  PASSWORD_RESET {
    string tokenHash PK
    uuid userId FK
    datetime expiresAt
  }
  TENANT {
    uuid id PK
    string name
    string slug UK
    TenantStatus status
  }
  BRANCH {
    uuid id PK
    uuid tenantId FK
    string name
    string slug
    string timezone
    BranchStatus status
    int nextOrderNumber
  }
  BRANCH_USER {
    uuid id PK
    uuid tenantId FK
    uuid branchId FK
    uuid userId FK
    MemberRole role
    boolean active
  }
  STAFF_INVITATION {
    uuid id PK
    uuid tenantId FK
    uuid branchId FK
    string email
    MemberRole role
    string tokenHash UK
    datetime expiresAt
    datetime acceptedAt
  }
  PLAN {
    string id PK
    string name
    int branchLimit
    boolean active
  }
  SUBSCRIPTION {
    uuid id PK
    uuid tenantId FK
    string planId FK
    SubscriptionStatus status
    datetime trialEndsAt
    datetime currentPeriodEndsAt
  }
  BRANCH_SETTINGS {
    uuid branchId PK
    uuid tenantId FK
    string preset
    QrMode qrMode
    SessionMode sessionMode
    PaymentMode paymentMode
    FulfillmentMode fulfillmentMode
    string promptpayId
  }
  MENU {
    uuid id PK
    uuid tenantId FK
    uuid branchId FK
    string name
    boolean active
  }
  MENU_CATEGORY {
    uuid id PK
    uuid tenantId FK
    uuid branchId FK
    uuid menuId FK
    string name
    int sortOrder
    boolean active
  }
  PRODUCT {
    uuid id PK
    uuid tenantId FK
    uuid branchId FK
    uuid menuId FK
    uuid categoryId FK
    string name
    decimal price
    boolean active
    boolean available
    int sortOrder
  }
  SERVICE_POINT {
    uuid id PK
    uuid tenantId FK
    uuid branchId FK
    string name
    ServicePointType type
    string qrToken UK
    boolean active
  }
  ORDER_SESSION {
    uuid id PK
    uuid tenantId FK
    uuid branchId FK
    uuid servicePointId FK
    string token UK
    SessionStatus status
    PaymentMethod paymentMethod
    PaymentStatus paymentStatus
    decimal subtotal
    string paymentReference
  }
  ORDER {
    uuid id PK
    uuid tenantId FK
    uuid branchId FK
    uuid sessionId FK
    uuid servicePointId FK
    int orderNumber
    string requestKey
    OrderStatus status
    PaymentMethod paymentMethod
    PaymentStatus paymentStatus
    decimal subtotal
    decimal total
    string paymentReference
  }
  ORDER_ITEM {
    uuid id PK
    uuid tenantId FK
    uuid branchId FK
    uuid orderId FK
    uuid productId FK
    string productNameSnapshot
    decimal unitPriceSnapshot
    int quantity
    decimal lineTotal
  }
  PAYMENT_CLAIM {
    uuid id PK
    uuid tenantId FK
    uuid branchId FK
    uuid orderId FK
    PaymentClaimStatus status
    string customerReference
    datetime submittedAt
    datetime reviewedAt
  }
  MANUAL_REFUND {
    uuid id PK
    uuid tenantId FK
    uuid branchId FK
    uuid orderId FK
    decimal amount
    RefundMethod method
    RefundStatus status
    string reference
    datetime completedAt
  }

  USER ||--o{ AUTH_SESSION : has
  USER ||--o{ PASSWORD_RESET : requests
  USER ||--o{ BRANCH_USER : joins
  TENANT ||--o{ BRANCH : owns
  TENANT ||--o{ BRANCH_USER : has
  TENANT ||--o| SUBSCRIPTION : subscribes
  PLAN ||--o{ SUBSCRIPTION : defines
  BRANCH ||--o| BRANCH_SETTINGS : configures
  BRANCH ||--o{ BRANCH_USER : employs
  BRANCH ||--o{ STAFF_INVITATION : invites
  BRANCH ||--o{ MENU : publishes
  MENU ||--o{ MENU_CATEGORY : groups
  MENU ||--o{ PRODUCT : contains
  MENU_CATEGORY ||--o{ PRODUCT : classifies
  BRANCH ||--o{ SERVICE_POINT : defines
  BRANCH ||--o{ ORDER_SESSION : opens
  SERVICE_POINT o|--o{ ORDER_SESSION : locates
  BRANCH ||--o{ ORDER : receives
  ORDER_SESSION o|--o{ ORDER : accumulates
  SERVICE_POINT o|--o{ ORDER : fulfills_at
  ORDER ||--|{ ORDER_ITEM : snapshots
  PRODUCT o|--o{ ORDER_ITEM : references
  BRANCH ||--o{ PAYMENT_CLAIM : reviews
  ORDER ||--o| PAYMENT_CLAIM : receives
  BRANCH ||--o{ MANUAL_REFUND : manages
  ORDER ||--o{ MANUAL_REFUND : refunds
```

Important modeling details:

- `Tenant → Branch → business records` is the ownership hierarchy. Branch-scoped foreign keys include tenant and branch identifiers so records cannot be related across tenants accidentally.
- `ServicePoint` generalizes tables, seats, zones, counters, and pickup locations.
- `OrderSession` is optional. It supports temporary QR codes and workflows that accumulate several independent orders before checkout.
- `OrderItem` stores product-name and unit-price snapshots. Historical orders therefore do not change when products are renamed or repriced. `productId` is nullable so the snapshot can survive product retirement.
- Payment state and order fulfillment state are separate. A `PREPARING` order can have a `PAID` or `PENDING` payment.
- `PaymentClaim` is a customer statement that payment was sent. It is never proof of settlement.
- `ManualRefund` records money returned outside the application. It does not rewrite the original paid order or total.
- Reviewer and actor fields such as `confirmedBy`, `reviewedBy`, and `completedBy` currently store user IDs as audit values but are not foreign-key relations. This preserves the record if a user is later deactivated.

## Customer order lifecycle

```mermaid
sequenceDiagram
  actor Customer
  participant Web as Next.js customer UI
  participant API as NestJS public API
  participant DB as PostgreSQL
  participant SSE as OrderEvents
  actor Staff

  Customer->>Web: Scan permanent or session QR
  Web->>API: GET public menu with opaque token
  API->>DB: Resolve active tenant, branch, service point/session, menu
  DB-->>API: Current products, prices, availability, workflow
  API-->>Web: Public menu
  Customer->>Web: Build cart and submit
  Web->>API: POST items, expected prices, method, idempotency key
  API->>DB: Serializable transaction and row locks
  Note over API,DB: Re-resolve active QR/session<br/>validate products and quantities<br/>read authoritative Decimal prices<br/>create order, snapshots, and payment state
  DB-->>API: Committed order
  API->>SSE: Publish branch-scoped new-order event
  API-->>Web: Created order
  SSE-->>Staff: New order signal
  Staff->>API: Refresh active orders and update status
  API->>DB: Persist validated transition
```

The client sends `expectedPrice` only to detect that its menu became stale. NestJS rejects mismatches and always computes totals from database prices. A unique tenant-scoped request key returns the original order for a repeated identical request and rejects reuse with a different payload.

## Current PromptPay and refund lifecycle

```mermaid
flowchart TD
  instructions["API reads the branch PromptPay recipient"]
  qr["Customer UI displays a locally generated amount-specific QR"]
  bankPayment["Customer pays in their mobile banking app"]
  claim["Customer submits a payment claim"]
  stored["API stores the claim as SUBMITTED and signals staff"]
  bankCheck["Staff checks the receiving bank account"]
  matched{"Does the deposit match?"}
  confirm["Staff records the receiving-bank reference"]
  paid["API marks payment PAID and claim VERIFIED"]
  reject["Staff rejects the claim with a reason"]
  pending["API marks claim REJECTED; payment remains PENDING"]
  refundRequest["Staff creates a full or partial refund request"]
  reserve["API reserves the amount and prevents over-refunding"]
  transfer["Manager returns money by bank transfer or cash"]
  complete["Manager records the external reference"]
  refunded["API marks refund COMPLETED; original order remains PAID"]

  instructions --> qr --> bankPayment --> claim --> stored --> bankCheck --> matched
  matched -->|Yes| confirm --> paid
  matched -->|No| reject --> pending
  paid -->|Optional refund| refundRequest --> reserve --> transfer --> complete --> refunded
```

The current application does not contact PromptPay or a bank. QR generation uses the configured recipient ID and server-calculated amount. Uploaded or customer-entered evidence would remain unverified until staff checks the receiving account. The [payment architecture guide](PAYMENTS.md) describes the exact current implementation, manual reconciliation improvements, slip-assisted review limits, and provider-ready design.

## External and internal service structure

```mermaid
flowchart TB
  subgraph devices[User-managed devices]
    phone[Customer phone browser]
    tablet[Staff tablet or phone browser]
    desktop[Admin or operator browser]
    banking[Restaurant banking application]
  end

  subgraph orderPlatform[Orderly-managed services]
    proxy[Caddy\nTLS and routing]
    next[Next.js\nUI and /api rewrite]
    nest[NestJS\nauthoritative application API]
    sse[SSE subject\nbranch-filtered hints]
    migrate[Prisma migration job]
    pg[(PostgreSQL\npersistent source of truth)]
  end

  subgraph providers[External provider services]
    resend[Resend\ntransactional email]
    bankAPI[Bank merchant QR API\nplanned]
  end

  phone --> proxy
  tablet --> proxy
  desktop --> proxy
  proxy --> next
  proxy --> nest
  next --> nest
  nest --> pg
  migrate --> pg
  nest --> sse
  sse --> tablet
  nest --> resend
  phone --> banking
  banking -. payment network .-> bankAPI
  nest -. dynamic QR request .-> bankAPI
  bankAPI -. signed callback and inquiry .-> nest
```

Current external dependencies:

- PostgreSQL is operational infrastructure and contains all critical state.
- Resend sends password-reset and staff-invitation email when `RESEND_API_KEY` and `EMAIL_FROM` are configured. Email delivery is not used for order correctness.
- Customer and restaurant banking apps perform PromptPay transfers outside Orderly.
- No object storage, Redis, message broker, payment gateway, bank API, or printer agent is currently required.

Planned direct-bank extension:

- Add a bank-provider interface for dynamic QR creation, signed callback verification, payment inquiry, and reconciliation.
- Add tenant-scoped merchant-account configuration backed by encrypted secret storage; never store live bank secrets in `BranchSettings` plaintext.
- Add a `PaymentAttempt` ledger with provider request IDs, merchant account, amount, currency, expiry, event hashes, and verified transaction references.
- Mark payment `PAID` only after the bank response matches tenant merchant, order/session reference, receiver, exact amount, currency, and a valid final status.
- Keep the current manual flow as a fallback when a branch has not completed bank onboarding or the provider is unavailable.

## Subscription lifecycle, scheduling, and notifications

The current subscription feature is a small entitlement representation rather than a billing system. It records a tenant's plan and status and enforces the plan's active-branch limit when another branch is created. It does not collect money, generate invoices, renew periods, run scheduled lifecycle transitions, or notify owners about trial or billing events.

### Current persisted model

`Plan` currently contains:

- a stable string ID
- display name
- `branchLimit`
- active state and creation time

The multi-tenant migration creates two plan definitions:

- `starter`: one active branch
- `standard`: two active branches

Prices are intentionally absent. The suggested ฿490/฿790 business assumptions are not application logic.

Each tenant can have one `Subscription` because `tenantId` is unique. It stores:

- `planId`
- `status`: `TRIAL`, `ACTIVE`, `PAST_DUE`, or `CANCELLED`
- optional `trialEndsAt`
- optional `currentPeriodEndsAt`
- creation and update timestamps

There is no provider customer ID, provider subscription ID, billing email, price/currency snapshot, invoice, payment attempt, grace deadline, cancellation schedule, status history, or notification record.

### What happens at signup

Restaurant signup transactionally creates:

1. the owner when needed
2. a tenant
3. a `starter` subscription with `status = TRIAL`
4. `trialEndsAt = signup time + 30 × 24 hours`
5. the initial branch, settings, menu, and owner membership

The calculation is an exact 30-day duration from the server clock. It is not rounded to midnight in the branch timezone. Migrated legacy POC data receives an `ACTIVE` standard subscription without trial or current-period dates.

### Current enforcement behavior

Subscription enforcement occurs only in `POST /api/restaurant/branches`:

1. The owner-only endpoint locks the tenant row inside a database transaction.
2. It loads the subscription and plan.
3. It permits only `TRIAL` or `ACTIVE`.
4. For `TRIAL`, it rejects the request when `trialEndsAt` is in the past.
5. It counts active branches and rejects creation when the count reaches `plan.branchLimit`.
6. It creates the branch, settings, menu, and owner membership in the same transaction.

The tenant lock serializes concurrent branch creation, so two simultaneous requests cannot both pass the branch limit.

No other current authorization path evaluates the subscription:

- `AuthGuard` validates the login session and active user.
- `MemberGuard` validates membership plus active tenant and branch.
- Public QR resolution validates active tenant, branch, service point/session, and QR mode.
- Menu management, staff operations, public order creation, reports, and existing branch use do not inspect subscription status or dates.

As a result, an expired trial, `PAST_DUE` subscription, or `CANCELLED` subscription continues operating on existing branches. It can still accept public orders and staff can continue normal work. The subscription prevents creating another branch but is not currently a service suspension mechanism. This behavior avoids accidentally interrupting a restaurant, but it is implicit rather than an explicit grace/access policy.

Changing from standard to starter while two branches are active does not deactivate either branch. It prevents further branch creation because the active count is already at or above the new limit.

`currentPeriodEndsAt` is not written or read anywhere in the current application. An `ACTIVE` subscription therefore remains active indefinitely until a platform operator changes its status manually.

### Current operator interface

`GET /api/platform/tenants` is protected by `OperatorGuard` and returns at most 100 newest tenants with:

- tenant identity and status
- creation date
- total branch count
- subscription status and trial end
- plan ID, name, and branch limit

`PATCH /api/platform/tenants/:id/subscription` allows an operator to change the plan between `starter` and `standard` and set any current subscription status. The endpoint does not update trial/current-period dates, validate a transition graph, record a reason, store the operator as an actor, or create an audit event.

The `/platform` page is currently read-only. It shows tenant, branch count, plan name, and status. It does not display trial expiry, provide status/plan controls, or call the subscription PATCH endpoint. The shared API client also exposes only the list operation, so manual changes require a direct authenticated API call or database administration.

Restaurant owners see the plan name, status, and branch limit through the branch response, and the branch-management page says that the subscription controls active branches. The normal owner UI does not show `trialEndsAt`, days remaining, renewal state, a billing portal, or a payment action.

### Current scheduling and notifications

There is no subscription scheduler.

- The NestJS application does not import `ScheduleModule` or define cron jobs.
- The production Compose stack contains PostgreSQL, migration, API, web, and proxy services only; there is no worker or scheduler service.
- No host-cron command or GitHub scheduled workflow advances subscriptions.
- An expired trial remains stored as `TRIAL` with a past timestamp.
- `currentPeriodEndsAt` does not trigger renewal, cancellation, or `PAST_DUE`.
- There is no reconciliation process for subscription state.

There are also no subscription notifications. `EmailService` currently sends password-reset, password-change, and staff-invitation email through Resend. No code sends trial reminders, expiry notices, payment-failure notices, renewal confirmations, cancellation notices, or operator alerts. There is no persistent in-app notification or delivery/outbox table.

```mermaid
flowchart TD
  signup["Restaurant signup"]
  trial["Create starter subscription: TRIAL with trialEndsAt +30 days"]
  time["Time passes"]
  scheduler["No scheduler or automatic transition"]
  use["Existing staff and public ordering continue"]
  branchRequest["Owner requests another branch"]
  check{"TRIAL or ACTIVE, trial not expired, below branch limit?"}
  create["Create branch transactionally"]
  reject["Reject branch creation"]
  operator["Operator may PATCH plan/status through API"]

  signup --> trial --> time --> scheduler --> use
  use --> branchRequest --> check
  check -->|Yes| create
  check -->|No| reject
  operator --> trial
```

### Problems to resolve before automatic billing

The current representation is safe for a POC but leaves several product decisions undefined:

- An expired trial and a cancelled subscription do not have an explicit access policy.
- Owners cannot see or act on upcoming expiry.
- Operators cannot manage subscriptions from the UI or audit who changed them.
- `currentPeriodEndsAt` has no meaning in runtime behavior.
- Plan downgrade overage is visible only when another branch is created.
- There is no billing contact distinct from staff accounts.
- Email failure, duplicate reminders, and retry behavior are undefined.
- A future billing webhook could arrive late, twice, or out of order, but there is no event ledger.
- There is no invoice/payment representation or link between money received and a subscription period.
- Tenant `SUSPENDED` and subscription restriction are not distinguished operationally. Tenant suspension currently blocks staff and public QR access and should remain reserved for security, abuse, or operator intervention rather than ordinary payment delay.

### Recommended separation of concerns

Treat four concepts separately:

1. **Plan definition:** commercial name, active state, branch limit, feature entitlements, and a reference to pricing rather than hard-coded UI prices.
2. **Billing state:** trial, active billing period, past due, cancellation, provider IDs, invoices, and money collection.
3. **Access policy:** the effective capabilities allowed right now, derived from billing state, timestamps, grace policy, tenant status, and plan entitlements.
4. **Notification delivery:** durable in-app/email messages generated from lifecycle events, independent of whether access checks succeed.

Centralize access evaluation in a service such as `SubscriptionAccessService`. It should return an effective state and entitlements for a tenant, for example:

- `FULL`: normal use
- `GRACE`: normal restaurant operation with prominent owner warnings; expansion may be blocked
- `RESTRICTED`: no new public orders, sessions, branches, invitations, or menu changes, while staff can finish active orders, process refunds, view history, and export data
- `BLOCKED`: tenant suspension for security/abuse; current behavior may deny all tenant access

The exact commercial policy remains a product decision, but restaurant operations should not stop at an arbitrary instant without warning. A practical default is:

- `TRIAL` before `trialEndsAt`: `FULL`
- expired trial: `RESTRICTED` after scheduled warnings, or a short explicit grace period
- `ACTIVE` before `currentPeriodEndsAt`: `FULL`
- `PAST_DUE` before `graceEndsAt`: `GRACE`
- `PAST_DUE` after grace: `RESTRICTED`
- cancellation scheduled for period end: `FULL` until `accessUntil`
- cancelled after access ends: `RESTRICTED`
- tenant `SUSPENDED`: `BLOCKED` independently of subscription

Apply effective access at request time. A scheduler must not be the only enforcement mechanism: if the scheduler is down when a trial expires, the next protected write must still calculate the correct access from persisted timestamps. The scheduler materializes transitions, sends notifications, and performs reconciliation; request-time policy protects correctness.

Use different capabilities instead of one global subscription guard. For example, `CREATE_ORDER`, `START_SESSION`, `MANAGE_MENU`, `INVITE_STAFF`, `CREATE_BRANCH`, `FULFILL_EXISTING_ORDER`, `PROCESS_REFUND`, and `EXPORT_DATA` can map to the access mode. This keeps a payment issue from stranding already accepted restaurant orders.

When a public branch becomes restricted, menu/status pages should return a clear temporary-unavailability response and existing order-status links should continue working. Staff should see the reason and recovery action. Never silently accept and discard an order.

### Recommended scheduler

For the present single-server deployment, use one durable command such as `npm run subscriptions:tick` invoked every 15 minutes by the deployment platform or a small Compose worker. Keep scheduling outside browser requests. Do not add Redis or a general queue solely for this feature.

The command should:

1. Acquire a PostgreSQL advisory lock so only one scheduler instance runs at a time.
2. Select due subscriptions in bounded batches using indexed timestamps.
3. Lock each selected subscription before evaluating it.
4. Recalculate effective lifecycle state from database time.
5. Write a `SubscriptionEvent` only for a real transition or due milestone.
6. Create notification outbox rows in the same transaction.
7. Commit before any email/network call.
8. Continue safely after one tenant fails.
9. Record run counts, duration, failures, and next due time.

At the current scale, a scan of due indexed records is sufficient. If volume grows, store `nextActionAt` on the subscription or create explicit `SubscriptionTask` rows and claim them with `FOR UPDATE SKIP LOCKED`. Every operation must be idempotent because schedulers can overlap or rerun after a crash.

Recommended time-based milestones are configurable rather than embedded throughout controllers. A simple starting policy is:

- trial started
- 7 days before trial end
- 3 days before trial end
- 1 day before trial end
- trial expired
- payment failed / subscription became past due
- grace period halfway point
- 1 day before grace ends
- access restricted
- payment recovered / access restored
- plan changed
- cancellation scheduled
- cancellation effective

Store lifecycle timestamps in UTC. Render dates in a configured tenant billing timezone; branch timezones may differ and should not determine one tenant-wide billing boundary.

### Recommended notification delivery

Use a transactional outbox in PostgreSQL rather than sending email inside the subscription update transaction.

Suggested `SubscriptionNotification` fields include:

- tenant and subscription IDs
- lifecycle event ID
- milestone/template key
- channel such as `IN_APP` or `EMAIL`
- recipient identity/address snapshot
- `PENDING`, `SENDING`, `SENT`, `FAILED`, or `CANCELLED`
- attempt count, `nextAttemptAt`, last error category, provider message ID, sent time, and creation time

Add a unique key across subscription, lifecycle occurrence, milestone, channel, and recipient. This prevents duplicate email when the scheduler reruns. A notification worker should claim due rows, send through `EmailService`, and retry transient failures with bounded exponential backoff. Permanent address/provider errors should remain visible to operators instead of retrying forever.

Email failure must never roll back a subscription transition or change the access policy. The owner UI should also show persistent billing banners/notices, so access information is available when email is delayed or unavailable.

Choose one tenant billing contact and optionally notify all active owners. Deduplicate shared addresses and store the intended recipient snapshot with the event. Staff should not receive billing email by default. Public customers should never receive tenant subscription messages.

### Suggested model extensions

Extend `Subscription` with the minimum fields required by the chosen policy:

- billing mode: `MANUAL` or provider identifier
- billing contact/user or email
- provider customer and subscription IDs when applicable
- `currentPeriodStartsAt`, `currentPeriodEndsAt`
- `graceEndsAt`
- `cancelAtPeriodEnd`, `cancelAt`, `cancelledAt`
- `accessUntil` when commercial access differs from provider status
- `nextActionAt`
- provider state version/event time for ordering updates

Add an append-only `SubscriptionEvent` containing tenant, subscription, previous/next state, effective time, source (`SIGNUP`, `SCHEDULER`, `OPERATOR`, or `PROVIDER`), external event ID, actor when applicable, reason, and creation time.

Add `SubscriptionNotification` as the durable outbox/delivery record. If automatic billing is selected later, add invoice and billing-payment records rather than reusing restaurant `Order` or `Payment` concepts; restaurant sales and SaaS subscription billing are separate domains.

Keep plan prices out of controller conditionals. A `PlanPrice` or provider price mapping can store currency, billing interval, amount in minor units, provider price ID, effective dates, and active state. Snapshot the applied plan/price on each billing period or invoice so historical billing does not change when pricing changes.

Useful indexes begin with due/state fields used by the scheduler, for example `(status, nextActionAt)` and `(status, trialEndsAt)`, while tenant-unique provider IDs and notification idempotency keys prevent cross-tenant ambiguity and duplicate work.

### Manual billing without an external billing provider

The improved scheduler and notifications do not require automatic billing. A simple operator-managed release can:

1. Add operator UI controls for plan, status, trial end, current period end, grace end, and a required reason.
2. Record every operator change as a `SubscriptionEvent`.
3. Store an external invoice/reference and optional paid date without pretending Orderly transferred money.
4. Let the scheduler send upcoming-expiry and past-due reminders.
5. Let the operator mark payment received and extend `currentPeriodEndsAt`.
6. Use centralized access policy for expiry and grace.
7. Show owners the current plan, limits, dates, notices, and contact/support action.

This supports bank transfer/manual invoicing while keeping lifecycle behavior deterministic. Operator changes should use optimistic concurrency or a row lock so a manual update cannot overwrite a scheduler transition.

### Automatic billing provider extension

When a billing provider is chosen, treat signed provider webhooks as billing inputs and PostgreSQL as the application source of truth:

1. Create checkout/customer/subscription requests server-side with tenant-scoped idempotency keys.
2. Store provider customer, subscription, price, invoice, and event identifiers with unique constraints.
3. Preserve and verify the raw webhook body according to the provider's signature scheme.
4. Durably record each provider event before processing it.
5. Reject invalid signatures and unknown merchant/account context.
6. Apply events idempotently and ignore stale out-of-order events using provider sequence/version/effective time.
7. Translate provider status into the internal billing state in one transaction, write a `SubscriptionEvent`, and enqueue notifications.
8. Periodically reconcile subscriptions and invoices through the provider API because webhooks can be delayed or missed.
9. Keep test/live credentials, endpoints, events, and subscriptions separated.

The provider should not call restaurant order APIs, and subscription webhooks should not reuse PromptPay order-payment records. A provider outage should delay billing reconciliation and notifications without corrupting restaurant orders.

### Target scheduling and notification structure

```mermaid
flowchart TD
  signup["Signup or operator/provider change"]
  subscription[("Subscription and plan in PostgreSQL")]
  request["Request-time SubscriptionAccessService"]
  capability{"Requested capability allowed?"}
  allow["Continue request"]
  deny["Return explicit restricted response"]
  clock["Deployment scheduler every 15 minutes"]
  lock["Acquire advisory lock and claim due subscriptions"]
  evaluate["Evaluate timestamps, grace, plan, and provider state"]
  transaction["Transaction: update state, append event, enqueue notifications"]
  outbox[("SubscriptionNotification outbox")]
  worker["Notification worker with retry/backoff"]
  email["Resend email"]
  banner["Persistent owner billing notice"]
  provider["Billing provider webhook/inquiry - optional"]

  signup --> subscription
  subscription --> request --> capability
  capability -->|Yes| allow
  capability -->|No| deny
  clock --> lock --> evaluate --> transaction --> subscription
  transaction --> outbox --> worker
  worker --> email
  worker --> banner
  provider --> evaluate
```

### Failure and recovery rules

- If the scheduler misses a run, request-time effective access still uses timestamps; the next run catches up lifecycle events and pending milestones.
- If two scheduler instances overlap, the advisory lock and notification uniqueness keys prevent duplicate transitions/messages.
- If the process crashes after the database commit but before email, the outbox remains `PENDING` and a later worker retries it.
- If email is unavailable, owner banners and operator views still show the current state; access does not depend on delivery.
- If a provider webhook is duplicated, the provider event unique key returns the already processed result.
- If webhooks arrive out of order, older provider versions/effective times cannot overwrite newer state.
- If a plan downgrade creates branch overage, do not deactivate branches automatically. Block expansion, show the overage, and require the owner/operator to choose which branch to deactivate or restore the higher plan.
- If access becomes restricted while orders are active, allow fulfillment, payment confirmation, refunds, history, and export for existing records. Reject new orders/sessions clearly.
- If a cancellation is reversed or payment recovers, restore access through a recorded transition and send one recovery notification.

### Recommended implementation sequence

1. Decide the trial-expiry, past-due grace, cancellation, and restricted-capability policy.
2. Add subscription dates, billing contact, `SubscriptionEvent`, and notification outbox migrations.
3. Add operator controls and owner subscription/billing status UI.
4. Implement centralized request-time `SubscriptionAccessService` and apply it first to expansion and new-order capabilities.
5. Add the idempotent scheduler command and notification worker using PostgreSQL.
6. Configure the deployment scheduler and monitoring; test scheduler downtime and catch-up.
7. Add manual renewal/invoice references if manual billing is the first commercial release.
8. Integrate one billing provider only after the internal lifecycle and notification behavior works end to end.

Prioritize tests for exact trial/period/grace boundaries, duplicate scheduler runs, retry after email failure, notification uniqueness, operator-versus-scheduler races, branch-limit concurrency, plan downgrade overage, provider event ordering, tenant isolation, and continued handling of active restaurant orders during restriction.

## Authentication and security boundaries

```mermaid
flowchart LR
  public[Public customer]
  user[Restaurant user]
  operator[Platform operator]

  token[Opaque QR token]
  cookie[HttpOnly same-site session cookie]
  membership[Active BranchUser membership]
  role[OWNER, MANAGER, or STAFF check]
  platformRole[OPERATOR platform role]

  customerOps[Menu, create order, order status, payment claim]
  staffOps[Orders, sessions, payment confirmation, refund request]
  adminOps[Menu, products, branches, staff, settings]
  platformOps[Tenant and subscription status]

  public --> token --> customerOps
  user --> cookie --> membership --> staffOps
  membership --> role --> adminOps
  operator --> cookie --> platformRole --> platformOps
```

Security controls currently include:

- Random UUID tokens for permanent service points and temporary order sessions.
- Hashed authentication, reset, and invitation tokens; raw tokens are sent only to the intended browser/email recipient.
- HttpOnly, `SameSite=Strict` session cookies and session expiry.
- Exact-origin and JSON content-type checks for state-changing requests.
- In-process login, reset, and write rate limits for the current single-API deployment.
- Tenant and branch scoping on restaurant queries and composite foreign keys.
- Server-side product, availability, price, total, state-transition, and refund-limit validation.
- Transactional order creation and row locks for order, payment review, and refund concurrency.
- Duplicate-submission protection through tenant-scoped idempotency keys and request hashes.

## Real-time behavior

The staff dashboard first loads active orders from PostgreSQL. It then listens to `/staff/events` for `new`, `changed`, and heartbeat messages. Events contain only a branch-scoped hint; the browser invalidates its TanStack Query cache and reloads authoritative state from the API.

`OrderEvents` is currently an in-process RxJS `Subject`, so the production topology intentionally runs one API replica. A future multi-replica deployment would need a shared event transport or database-backed notification mechanism. Losing an event does not lose an order because the dashboard also polls and refreshes from PostgreSQL.

## Deployment structure

```mermaid
flowchart LR
  internet[Internet]
  dns[Restaurant ordering domain]
  caddy[Caddy container\nports 80 and 443]
  web[Web container\nNext.js 3010]
  api[API container\nNestJS 3011]
  migration[Migration container\none-shot]
  postgres[(PostgreSQL container\nprivate volume)]

  internet --> dns --> caddy
  caddy -->|all pages| web
  caddy -->|/api/* including SSE| api
  web -->|private Docker network| api
  migration -->|Prisma migrate deploy| postgres
  api -->|DATABASE_URL| postgres
```

Required production properties are an HTTPS `APP_ORIGIN`, a PostgreSQL connection URL, a strong database password, and the public hostname. Resend settings are required only for recovery and invitation email. Deployment runs migrations before the API and keeps PostgreSQL off the public edge.

## Current architectural limits

The following limits are deliberate and should be considered when extending the system:

- One shared PostgreSQL database with tenant-scoped tables; no database-per-tenant model.
- One active API replica because SSE notifications and rate-limit buckets are in process.
- Manual PromptPay settlement confirmation; no automatic bank or gateway verification.
- Manual refunds record external money movement; Orderly does not initiate a transfer.
- Basic subscription representation without scheduling, notifications, recurring billing, period enforcement, or automatic access changes; only new-branch creation currently checks subscription status, trial expiry, and plan branch limit.
- Gross-sales reports do not yet subtract completed refund records.
- Product availability is a sold-out toggle rather than quantity or cost inventory.
- No offline-first synchronization, message broker, Redis, microservices, or native mobile application.

These boundaries keep the current product focused on QR-to-menu-to-order operations while preserving clear seams for bank payments, inventory, tax documents, and multi-replica real-time delivery later.

# System architecture

This document describes the current `develop` branch of Orderly, including the monorepo, runtime services, database model, security boundaries, and external integrations. Solid arrows in the diagrams are implemented. Dashed arrows and dashed boxes describe planned extension points.

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
- Basic subscription representation without automatic recurring billing.
- Gross-sales reports do not yet subtract completed refund records.
- Product availability is a sold-out toggle rather than quantity or cost inventory.
- No offline-first synchronization, message broker, Redis, microservices, or native mobile application.

These boundaries keep the current product focused on QR-to-menu-to-order operations while preserving clear seams for bank payments, inventory, tax documents, and multi-replica real-time delivery later.

# Ordering API

NestJS API for public QR ordering, authenticated restaurant operations, and a separate platform operator view. See the [root README](../../README.md) for setup and deployment.

`/public/:kind/:token` resolves permanent (`q`) or session (`s`) QR links without customer login. `/auth` handles signup, login, branch context, and sessions. `/restaurant` manages branches, staff, settings, service points, and order sessions. `/admin` manages branch-scoped categories and products. `/staff` serves orders, reports, manual payments, and branch-filtered SSE. `/platform` requires an OPERATOR account.

Every private request rechecks branch membership. Orders use serializable transactions, server-side Decimal totals, product snapshots, idempotency keys, and guarded state transitions.

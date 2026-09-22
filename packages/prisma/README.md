# Shared database package

Prisma 7 and PostgreSQL driver adapter. Owns the tenant/branch-scoped schema, the legacy-preserving multi-tenant SQL migration, plan definitions, optional platform operator seed, and shared generated client exports. Monetary values use Decimal(10,2); order item snapshots preserve historical names and prices. See the root README for deployment and test commands. Use reviewed migrations for production rather than `db push`.

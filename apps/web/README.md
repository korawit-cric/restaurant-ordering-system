# Ordering web app

Next.js App Router customer, staff and admin interfaces. See the [root README](../../README.md). API contracts live in `@repo/api-client`; fetching stays in this app. Local `/api` requests are forwarded to NestJS. Production Caddy forwards them directly for reliable SSE.

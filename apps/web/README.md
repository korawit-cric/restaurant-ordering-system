# Ordering web app

Next.js App Router customer, staff, restaurant setup, and platform views. See the [root README](../../README.md). API endpoint contracts live in `@repo/api-client`; browser/server fetching stays in this app. Local `/api` requests are forwarded to NestJS; production Caddy forwards them directly so SSE streams flush promptly.

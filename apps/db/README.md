# PostgreSQL

Run `npm run db:start` from the repository root. This starts PostgreSQL 16 on localhost port 5444 using root `.env` configuration. Data lives in a named Docker volume. `npm run db:stop` stops the database without deleting its volume. See the root README for production deployment and backups.

# Ordering API

NestJS application for the QR ordering MVP. See the [root README](../../README.md) for setup, rules, security and deployment.

Public routes resolve `/public/tables/:token/menu` and create/read a specific order under that table. `/auth` manages staff sessions. `/staff` provides orders, status/payment actions, summary and SSE. `/admin` manages menu, categories, tables and QR images. Admin endpoints require ADMIN; operational endpoints allow STAFF or ADMIN.

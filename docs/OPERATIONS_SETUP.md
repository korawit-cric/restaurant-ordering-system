# Payments, account email, receipts, and stock

This guide separates what Orderly runs today from the merchant and accounting setup needed for live operation. It was checked against provider and Thai Revenue Department documentation on 22 September 2026.

## Account email: implemented

Password reset and staff invitations use Resend's email API. Reset links expire after 30 minutes, invitations after 48 hours. Tokens are random, stored only as hashes, and consumed once. Resetting a password revokes every existing login session. The request page gives the same response for registered and unknown email addresses.

1. Create a [Resend account](https://resend.com/docs/introduction) and verify a domain you control. Publish the DNS records Resend shows for sending (including SPF and DKIM); wait until it reports the domain as verified.
2. Create a sending API key. Set `RESEND_API_KEY` and `EMAIL_FROM` (for example, `Orderly <accounts@your-domain.example>`) in the server's `.env`. Keep the key out of browser environment variables and source control. Set `APP_ORIGIN` to the exact public HTTPS origin; links are built from that value, never from a request's Host header.
3. Back up the database, deploy the new migration with `npm run db:deploy`, and restart the API. In the supplied production Compose setup, `docker compose -f compose.production.yml up -d --build` runs migrations before starting the API.
4. Test `/staff/forgot-password` using a test account. The recipient should receive a link, set a new password, and find the old session and old password unusable. Then sign in as an owner and invite a staff member from `/admin/staff`. Test both a new email address and an existing Orderly account. Revoke a pending invitation and confirm its link stops working.
5. Monitor Resend delivery and API errors. The app does not reveal whether a reset address exists. If delivery is not configured, reset requests and invitations are unavailable rather than exposing reset links in logs.

The integration uses [Resend's Send Email API](https://resend.com/docs/api-reference/emails/send-email). Password reset behavior follows [OWASP's forgot-password guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html). The legacy owner-created password endpoint remains for compatibility, but the staff screen now uses invitations.

## PromptPay: choose a payment provider before enabling automatic confirmation

Orderly currently creates an amount-filled PromptPay QR for a branch's configured recipient ID. This QR has **no transaction reference that Orderly can verify**. It stays pending until a staff member confirms the deposit in the receiving bank account. The customer can press **I have paid** and optionally enter the reference shown by their bank. This only creates a review claim; it never marks the order paid.

For the no-provider workflow:

1. Configure and test the branch PromptPay recipient in `/admin/settings`.
2. The customer scans the amount-specific QR and presses **I have paid** after transferring.
3. Staff sees the claim on the order card, opens the restaurant's bank app or statement independently, and matches recipient account, exact amount, and a plausible transfer time. Do not rely on a screenshot supplied by the payer.
4. Staff presses **Confirm PromptPay** and records the reference from the receiving bank account. Orderly then stores the reviewer, time, reference, and optional note and marks payment paid. Staff can reject an unmatched claim with a reason, after which the customer may correct and resubmit it.

This is an audited manual control, not automatic PromptPay verification. It does not prove a transfer through the PromptPay network and cannot discover a deposit without a person checking the receiving account.

Two documented gateway paths are:

- **Omise/Opn:** Apply to enable PromptPay for the merchant account, then create a PromptPay source and charge with the server-calculated amount in satang. Show the charge's QR image. Handle `charge.complete` and verify the charge again through the API before recording payment. Omise's [PromptPay guide](https://docs.omise.co/promptpay) says PromptPay charges cannot be voided or refunded through Omise. Its [webhook guide](https://docs.omise.co/api-webhooks/thailand) documents HMAC signature verification and independent event/resource verification.
- **Xendit:** Create a one-time Payment Request using `QRPROMPTPAY`, `THB`, the server-calculated amount, and a unique order/session reference. Show its QR action. Verify the `x-callback-token` on payment webhooks and match the payment request, reference, amount, currency, merchant, and final status before marking paid. The current [PromptPay channel page](https://docs.xendit.co/docs/qr-promptpay) lists refunds as unavailable; see its [payment request](https://docs.xendit.co/apidocs/create-payment-request) and [webhook](https://docs.xendit.co/apidocs/payment-webhook-notification) docs.

For a shared SaaS, decide first **who is the merchant receiving funds**: each restaurant's own gateway account, or the platform account with provider-approved sub-merchants/settlement. This determines onboarding, credentials, settlement, reconciliation, and legal responsibility. Never reuse one restaurant's secret key for another restaurant. Confirm provider support for the selected account model and merchant contracts before building the adapter.

The implementation sequence is:

1. Add a tenant-scoped `PaymentAttempt` for each order or closed checkout session, with provider, merchant account, provider request ID, amount in minor units, currency, expiry, and state. Keep the existing manual method separate.
2. Create a unique provider request on the NestJS server from the authoritative order/session total. Use an idempotency key so retries return the same QR and do not create another charge. Store the provider reference before showing the QR.
3. Add a webhook endpoint exempt from the browser Origin check **only for that exact route**. Verify the provider signature or callback token before parsing business meaning. Retrieve the charge/payment from the provider where supported. In one transaction, match merchant, reference, amount, currency, and allowed state transition; deduplicate provider events and update payment state once.
4. Reconcile pending attempts against provider records on a schedule. Webhooks can be delayed, retried, duplicated, or missed. Keep PostgreSQL as the source of truth and notify the staff board after a committed change.
5. Test sandbox success, failure, expiry, duplicate webhook, out-of-order webhook, timeout, service restart, and multi-tenant isolation. Switch to live keys only after the provider enables the merchant account and a real low-value transaction reconciles.

There is no automatic-verification adapter in this repository yet. The provider, merchant-account model, live/test credentials, and webhook secret are still required decisions. Do not put them in `BranchSettings` as plaintext.

## Refunds: implemented as a manual operational record

For the PromptPay options above, the cited channel guides do not offer API refunds. Orderly therefore records a manual refund while the restaurant returns money by cash or bank transfer outside the app. From a paid order's detail page, staff can request a full or partial refund with its amount, method, and reason. Pending and completed refunds reserve value so their combined amount cannot exceed the original payment. An owner or manager marks the refund completed only after money is returned; a bank transfer requires its transaction reference. They can cancel a pending request.

The order remains historically **paid**. Refund amount, reason, requester, completion/cancellation actor and time, and external reference are separate audit data. A partial refund does not change the original order total, and cancelling an order does not imply money was returned. Current sales summaries remain gross payment reports; use the refund records separately until net-sales reporting is added.

Before live use, decide who may request refunds, whether cash refunds are allowed, what evidence is retained, and whether returned goods re-enter stock. The current policy allows any branch staff member to request a refund and restricts completion/cancellation to owners and managers. If the chosen gateway later supports a specific refund API, the server can add provider idempotency, webhook reconciliation, and a `REQUESTED → SUCCEEDED/FAILED` lifecycle. Do not call a bank transfer or a staff checkbox an automatic refund.

## Thai receipts and tax invoices: confirm registration before issuing

Orderly does **not** currently issue a tax invoice or e-Tax document. Its order confirmation is an operational record. Until this feature is built and reviewed, issue fiscal documents through the restaurant's existing accountant, POS, or approved e-Tax process, using the Orderly order number as a reference.

Determine whether each tenant is VAT registered. The Revenue Department states that regular Thai businesses exceeding the **฿1.8 million annual turnover** threshold generally must register for VAT; registration and exemptions depend on the business. A [full tax invoice](https://www.rd.go.th/english/37741.html) requires the issuer's legal name, address, tax ID, buyer details, serial number, item descriptions/quantities/values, separately stated VAT, and issue date. Retail [abbreviated tax invoices](https://www.rd.go.th/english/37741.html) have different required fields and show VAT-inclusive prices. Thai-language/currency rules and branch-identification rules also apply. The Revenue Department's [e-Tax standards](https://www.rd.go.th/65244.html) add digital signature or approved time-stamping and submission requirements; a plain PDF emailed by this app is not automatically a compliant e-Tax invoice.

Before implementing issuance, collect the seller's registered name, Thai tax ID, registered address, VAT status, branch number, approved invoice series, and buyer fields when a full invoice is requested. Decide VAT-inclusive/exclusive price policy and rounding with the restaurant's accountant. Then add immutable invoice snapshots, branch-scoped sequential numbering, duplicate/reprint controls, and credit-note handling for corrections or refunds. Verify sample outputs and the selected e-Tax route with a Thai tax professional before live issuance. Keep tax documents for the retention period specified by the [Revenue Department](https://www.rd.go.th/english/37747.html).

## Stock accounting: choose the inventory unit and costing method

Orderly currently has only the `available` toggle. It does not know on-hand quantity, purchase cost, recipes, shrinkage, or cost of goods sold; today's sales report must not be treated as stock accounting.

For a first product-level stock ledger, choose stock-tracked products and units (bottle, can, portion), then enter opening balances per branch. Record receipts with supplier, quantity, unit cost, and source document; waste and corrections with reasons; and consumption when a sale reaches a defined fulfillment state. Keep immutable movements and a derived on-hand balance. Reject negative stock only if the business wants strict blocking; bars may need a warning instead when counts lag. Cancelling an unprepared order and returning a sealed item can reverse a movement, while a refund alone should not automatically restock. Choose FIFO or weighted-average cost with the accountant before reporting COGS or inventory value.

If the business needs cocktails or kitchen ingredients, add recipes and unit conversions **after** product-level tracking works. That is a distinct, larger requirement. Confirm whether the first release needs simple product counts or financial inventory valuation before changing the order transaction; stock mistakes must never silently erase a valid customer order.

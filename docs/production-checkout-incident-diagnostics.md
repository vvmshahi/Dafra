# Production checkout incident diagnostics

Date: 2026-07-26
Purpose: diagnose the branch-device checkout failure without changing data or
retrying destructive operations.

## Ranked hypotheses

| Rank | Hypothesis | Supporting evidence | Evidence against | Confirming test | Expected signal |
| ---: | --- | --- | --- | --- | --- |
| 1 | Product/unit/cart validation or insufficient stock | Same failing devices may share the same operational cart/catalog; many RPC validation errors collapse to the generic toast | Owner may truly be using the identical cart, but that must be proven item-by-item | Reproduce one-item cart using exact product, selling unit, quantity and payment; compare RPC response | HTTP 400 with SQLSTATE `22023`/`23514`, message about stock, unit version, inactive unit, precision or availability |
| 2 | Stale/closed register session | Multiple devices can hold a session in UI state after another device closes it; checkout validates exact session server-side | Initial POS load fetches current open session from DB and does not use browser date | Compare payload `session_id` with current `pos_sessions` row immediately after failure; refresh and retry once | HTTP 400/403; SQLSTATE `42501`; `POS session is not open for this branch` |
| 3 | Branch network, proxy, DNS, TLS or request blocking | Two co-located devices fail while remote owner works | If devices use independent networks this weakens it | Capture Network error, then repeat on phone hotspot | `Failed to fetch`, CORS/DNS/TLS error, status 0, 502/503/504, or missing request |
| 4 | Cached/stale frontend or service worker/browser storage | Branch devices may share an older deployed bundle or persisted atomic request; owner may have current assets | No application service worker was established in the reviewed path; atomic payload persistence is designed for replay | Compare deployed asset hashes/version, hard reload, inspect service workers and the scoped atomic local-storage record without deleting first | Old asset URL/version, controlled service worker, or stale `dafra:atomic-checkout:*` record |
| 5 | Permission/profile/branch scope mismatch | Branch role must match exact tenant/branch; the generic mapper may hide some error shapes | Same branch account works remotely if literally the same authenticated user/session | Capture JWT user ID only through Supabase dashboard/auth logs and compare profile/branch; do not copy token | HTTP 401/403, SQLSTATE `42501`, `Forbidden`, inactive profile/branch |
| 6 | Atomic checkout capability, chain or deployment error | Production simplified sales use atomic preparation; chain/capability/function-hash failures can become generic | Owner on same branch should normally hit the same server state, unless checkout document/customer path differs | Compare `standardRequested`, demo/production status and exact atomic RPC response | `CHAIN_*`, `ATOMIC_*`, capability/function-drift error, HTTP 400 |
| 7 | Idempotency/pending request conflict | Client persists atomic payload and fingerprint; stale state can change replay behavior | Keys are opaque and scoped; a timezone difference cannot create a semantic conflict | Inspect scoped pending record, key/fingerprint and server intent by key; do not edit until captured | Fingerprint mismatch, reused-key error, prepared/expired intent |
| 8 | Service worker or CDN partial deployment | Two branch devices may have cached the same old frontend | No evidence yet of a registered worker; Vite asset hashing normally mitigates this | DevTools Application and Network “Disable cache” comparison | Old JS hash or worker-controlled response |
| 9 | Physical device clock | Can affect TLS and Supabase refresh scheduling | Timezone alone is harmless; two devices would need materially wrong absolute clocks | Compare against a trusted network time source; inspect 401/TLS behavior | Certificate-date error, JWT refresh/401, not a business validation |
| 10 | Browser timezone | Confirmed to affect invoice-list display | Checkout sends no date/time and server controls transaction time | Change timezone only after capturing baseline; identical request/result is expected | Display changes; RPC payload and commercial result do not |
| 11 | ZATCA issue timestamp | ZATCA has strict timestamp rules | Timestamp is derived from stored server instant; simplified atomic commercial commit is not browser-timed | Inspect whether failure occurs before invoice creation and whether an invoice ID exists | ZATCA/finalization error after local invoice, not a browser-time checkout rejection |
| 12 | Daily invoice counter/date reset | Would be sensitive to business day if implemented | Counters are monotonic per branch and do not reset daily | Inspect branch counter and duplicate invoice-number constraint | Counter/unique violation, unrelated to browser timezone |

The “same cart” claim must include product IDs, selling units, quantities,
customer type/VAT number, payment method and register ID. Visually similar
carts can take different package, B2B or atomic paths.

## Branch-device capture procedure

Perform this on one failing device before clearing storage or reinstalling.
Record the Saudi-local failure time to the second.

### 1. Clock and timezone

1. Open the operating-system Date & Time settings.
2. Record:
   - automatic time on/off;
   - displayed local time including seconds;
   - timezone name;
   - UTC offset.
3. Compare the absolute time with a trusted network clock. A different timezone
   is acceptable if the absolute instant is correct.
4. In DevTools Console run read-only commands:

```js
({
  nowIso: new Date().toISOString(),
  local: new Date().toString(),
  zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  offsetMinutes: new Date().getTimezoneOffset(),
})
```
5. Screenshot the result without showing tokens or customer information.

### 2. Exact checkout capture

Record:

- product names/SKUs and, internally, product IDs;
- Piece/Carton/base selling unit;
- quantity for every line;
- customer type and whether B2B/VAT-qualified, but not unnecessary customer
  personal data;
- payment mode and split/non-split status;
- whether the stock display showed sufficient inventory;
- current register’s visible opened time;
- whether a different device recently closed/reopened the register.

Repeat with one simple known-in-stock base-unit product and cash payment only.
Do not repeatedly click Complete Sale; one controlled attempt is sufficient.

### 3. Network request

1. Open DevTools → Network.
2. Enable Preserve log.
3. Filter for:
   - `rpc`;
   - `pos_checkout`;
   - `prepare_zatca_atomic_checkout_v2`;
   - `claim_zatca_atomic_signing_lease_v2`;
   - Supabase project hostname.
4. Trigger one checkout.
5. Save a HAR **with sensitive values removed**. Do not share Authorization,
   apikey, cookies, customer records, signed XML or certificates.
6. For the failed request capture:
   - URL path/RPC name;
   - start time and duration;
   - HTTP status;
   - response `code`, `message`, `details`, `hint`;
   - request `session_id`, idempotency-key suffix/hashed representation,
     item count and presence of package fields—not the bearer token.
7. Check whether a successful invoice response exists before a later ZATCA
   request fails. If it does, do not retry checkout until duplicate status is
   checked.

Expected distinction:

- no request/status 0: browser/network;
- 401: expired/invalid auth;
- 403 or SQLSTATE `42501`: scope/session/branch authorization;
- 400 with `22023`: payload/unit/quantity validation;
- 400 with `23514`: stock/payment/business constraint;
- 409/unique/fingerprint language: idempotency or conflict;
- 5xx: server/Edge/database availability or unexpected error.

### 4. Console

Capture the expanded object logged after:

```text
[POSPage charge] checkout failed
```

Record its `name`, `message`, `code`, `details`, `hint`, status and stack origin.
Redact tokens and personal data. Also capture:

- `[usePosSession] active session query failed`;
- atomic checkout messages;
- failed resource/CORS/TLS messages;
- Supabase `SIGNED_OUT` or token-refresh symptoms.

### 5. Network isolation

After the baseline capture:

1. connect the same device to a phone hotspot;
2. hard reload;
3. sign in normally;
4. retry the same controlled one-item cart once.

Hotspot success strongly supports branch DNS/proxy/firewall/TLS interference.
Hotspot failure with the same structured RPC response points back to
application/data state.

### 6. Storage and cached client

Before deletion, DevTools → Application:

1. record registered service workers and whether the page is controlled;
2. record Cache Storage names;
3. inspect local storage keys beginning with:

```text
dafra:atomic-checkout:
```

4. capture only:
   - key name;
   - document type;
   - branch/scope IDs;
   - idempotency key hashed or last 8 characters;
   - fingerprint;
   - presence and approximate age.

Do not publish the full cart payload. Also record the loaded JS asset filenames
and compare them with the successful owner device.

Only after evidence is saved:

- unregister an unexpected service worker;
- clear site cache/storage or use a clean browser profile;
- sign in and perform one controlled retry.

### 7. Register state

Using Supabase SQL Editor in read-only mode or Table Editor:

```sql
select id, tenant_id, branch_id, status, opened_at, closed_at, opened_by, closed_by
from public.pos_sessions
where branch_id = '<branch-id>'
order by opened_at desc
limit 10;
```

Compare the failed payload’s `session_id` with the only open row. Confirm:

- same branch and tenant;
- `status = 'open'`;
- `closed_at is null`;
- no second concurrent open row;
- whether another device closed it at the failure time.

Do not update the row during diagnosis.

### 8. Duplicate invoice and atomic intent check

Before retrying after an uncertain response:

```sql
select id, invoice_number, checkout_idempotency_key, created_at, invoice_date,
       status, zatca_status, session_id, total_amount
from public.invoices
where branch_id = '<branch-id>'
  and created_at between '<failure-utc-minus-5m>' and '<failure-utc-plus-5m>'
order by created_at;
```

For authorized operators with access to the private atomic table:

```sql
select id, branch_id, document_type, state, invoice_id, invoice_number,
       created_at, issue_at, expires_at, committed_at, failure_code
from public.zatca_atomic_checkout_intents_v2
where branch_id = '<branch-id>'
  and created_at between '<failure-utc-minus-5m>' and '<failure-utc-plus-5m>'
order by created_at;
```

Do not retrieve request payloads, receipt snapshots, hashes, XML or signing
material unless an authorized incident responder specifically requires them.

## Supabase production log checks

Use the exact UTC failure time derived from the device’s `nowIso`. Search a
five-minute window first, then widen to fifteen minutes.

### API/PostgREST logs

Filter:

- user/actor ID and branch ID where available;
- paths containing `/rest/v1/rpc/pos_checkout`;
- atomic RPC names around preparation, claim and commit;
- HTTP status 400, 401, 403, 409 and 5xx.

Capture request ID, status, duration and sanitized error. Do not export request
Authorization headers.

### Postgres logs

Search for:

- `POS session is not open for this branch`;
- `Insufficient stock`;
- `Invalid checkout item`;
- product-unit inactive/version/precision errors;
- `Forbidden`, inactive profile/branch or suspended account;
- `ATOMIC_`, `CHAIN_`, fingerprint or idempotency errors;
- unique/constraint violations;
- statement timeout, serialization/deadlock, connection exhaustion.

Correlate by timestamp, actor database role, function name and request ID. The
branch ID may appear in structured API metadata even when not in the PostgreSQL
error string.

### Auth logs

Search the user ID and failure window for:

- refresh-token reuse/revocation;
- invalid/expired JWT;
- sign-out;
- repeated login failure;
- rate limiting.

A normal token refresh with a 400 RPC business error weighs against device
clock/auth as the cause.

### Edge Function logs

For `zatca-submit`, atomic signing/finalization and sandbox functions:

- determine whether any invocation began;
- correlate invoice ID and sanitized request ID;
- distinguish no invocation, pre-commercial failure, post-commercial ZATCA
  failure, and retry/outbox activity.

Never search or paste private keys, certificate secrets, signed XML or bearer
tokens into tickets.

## Vercel/CDN checks

If the frontend is served by Vercel:

1. identify the production deployment active at failure time;
2. compare the branch device’s loaded hashed JS asset names with that
   deployment and the owner laptop;
3. inspect 404/5xx rates for static assets and configuration endpoints;
4. confirm environment variables point to the intended Supabase project;
5. check deployment/runtime logs only if a serverless route participates.

The reviewed checkout is browser-to-Supabase, so ordinary Vercel function logs
may contain no checkout request. Absence there is expected; Supabase API,
Postgres, Auth and Edge logs are primary.

## Decision tree

```text
Failed checkout
├─ No Supabase request / status 0
│  ├─ Hotspot works → branch network/proxy/DNS
│  └─ Clean profile works → cache/storage/service worker
├─ 401 → auth/token/device absolute clock
├─ 403 or 42501
│  ├─ session ID closed/mismatched → stale register state
│  └─ actor/branch mismatch → permission/scope
├─ 22023/23514 → cart, unit, payment or stock validation
├─ ATOMIC_/CHAIN_/fingerprint → atomic state/deployment/idempotency
└─ Invoice exists despite error
   └─ do not resubmit; diagnose ZATCA/output phase and replay safely
```

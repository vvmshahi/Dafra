# Atomic Checkout Performance Instrumentation

## Scope and safety

This instrumentation measures the existing simplified atomic checkout path. It
does not optimize, remove, reorder, or move checkout work. It does not change
the success boundary, invoice calculations, signing, QR generation, ZATCA
chain behavior, reporting, print eligibility, or any standard/legacy path.

Timing is diagnostic and fail-open. Logging is wrapped in `try/catch`, so a
console or serialization failure cannot fail checkout. Durations use the
monotonic `performance.now()` clock, are clamped to `0..3,600,000` milliseconds,
and are rounded to one decimal place.

## Edge timing stages

Edge events use the prefix `[zatca-checkout-perf]`.

| Event | Measured operation |
|---|---|
| `request_total` | Total successful fresh simplified Edge request through response serialization |
| `auth_get_user` | `auth.getUser` |
| `caller_profile_load` | Caller `user_profiles` query |
| `runtime_capabilities_load` | Runtime finalization capability load |
| `branch_authorization` | Authorized branch query and check |
| `idempotency_result_lookup` | `get_zatca_atomic_checkout_result_v2` |
| `legacy_idempotency_lookup` | Legacy invoice idempotency query |
| `rollout_initial_load` | Initial runtime and branch-gate load |
| `readiness_initial_load` | `get_zatca_branch_readiness_v2` |
| `capability_acknowledgement` | Capability acknowledgement RPC, or `skipped` |
| `readiness_reload` | Readiness reload following acknowledgement, or `skipped` |
| `eligibility_sync` | Atomic branch eligibility synchronization, or `skipped` |
| `rollout_reload` | Post-synchronization rollout reload, or `skipped` |
| `rate_limit` | `consume_rate_limit` |
| `attempt_audit` | Attempt audit RPC |
| `atomic_prepare_total` | `prepare_zatca_atomic_checkout_v2`, including its existing commercial preview and snapshot work |
| `signing_claim` | One signing-claim RPC attempt; contention can produce multiple events |
| `credential_load` | Production credential row query |
| `credential_decryption` | Existing private-key and CSID decryption combined |
| `xml_generation` | Existing XML data and unsigned XML construction combined |
| `signing_and_qr` | Existing `signInvoice`, including QR creation |
| `artifact_validation` | Prepared-artifact identity and signed XML hash verification combined |
| `artifact_storage` | `store_zatca_atomic_checkout_artifact_v2` |
| `atomic_commit_total` | `commit_zatca_atomic_checkout_v2`, including the existing commercial commit, snapshot verification, chain update, invoice artifact update, and durable outbox insert |
| `background_reporting_schedule` | Scheduling the existing unawaited outbox drain |
| `success_audit_schedule` | Scheduling the existing unawaited success audit |
| `response_serialization` | Successful committed response serialization |

Combined spans are intentionally reported as combined spans. The
instrumentation does not claim sub-stage precision where the current function
or database RPC does not expose it.

## Browser timing stages

Browser events use the prefix `[pos-checkout-perf]`.

| Event | Meaning |
|---|---|
| `charge_clicked` | Accepted charge invocation and correlation-context creation |
| `client_validation` | Existing client preparation and validation before atomic invocation |
| `atomic_invoke_start` | Immediate marker before the Supabase Edge invocation |
| `atomic_invoke_duration` | Full awaited Edge invocation duration |
| `response_received` | Edge invocation returned to the client |
| `receipt_state_created` | React receipt state was created from a committed atomic receipt |
| `success_screen_visible` | Receipt view reached the next animation frame |
| `print_modal_ready` | Stored QR rendering completed and the existing print-ready predicate became true |

These browser events are attached only to the simplified atomic result. Standard
and legacy checkout rendering remains unchanged.

## Structured log format

Edge record:

```text
[zatca-checkout-perf] {
  event: "atomic_prepare_total",
  operation: "prepare_zatca_atomic_checkout_v2",
  requestId: "safe-correlation-id",
  durationMs: 123.4,
  elapsedMs: 456.7,
  action: "checkout_simplified",
  status: "ok",
  coldStartCandidate: false
}
```

Browser record:

```text
[pos-checkout-perf] {
  event: "atomic_invoke_duration",
  requestId: "safe-correlation-id",
  durationMs: 123.4,
  elapsedMs: 456.7,
  action: "checkout_simplified",
  status: "ok",
  coldStartCandidate: false
}
```

`durationMs` is the individual span duration. `elapsedMs` is cumulative from
the browser charge start or Edge request start. `status` is one of `ok`,
`error`, `skipped`, or, where applicable on Edge, `legacy_required`.
`operation` is an Edge-only fixed label selected by source code; it is never
raw SQL or user input.

## Browser-to-Edge correlation

The browser creates one random UUID with `crypto.randomUUID()` when an accepted
charge starts. It passes that value as `checkoutPerfRequestId` in the existing
Edge request body. Edge accepts only a restricted 8-to-80-character
alphanumeric, underscore, or hyphen value; otherwise it generates a new UUID.

The safe ID is used as `requestId` in both log streams and is added only to a
successful committed atomic response as the optional
`checkoutPerfRequestId` field. Existing clients ignore the optional field.
Errors and legacy-required responses are not rewritten.

No Server-Timing or request-ID response header is added. Doing so would require
refactoring the shared response helper used by unrelated ZATCA actions, while
the Supabase browser invocation does not currently expose those headers to this
client path. Structured correlated logs avoid that broader behavior risk.

## Privacy and secret safety

Performance records may contain only fixed event/operation names, the random
correlation ID, bounded timing numbers, the fixed action, result status, and
the cold-start candidate boolean.

Never add any of the following to performance logs:

- Cart, product, customer, buyer, seller, or branch contents.
- Item names, quantities, prices, discounts, tax amounts, totals, payments, or notes.
- Invoice XML, QR content, invoice-content hashes, or receipt payloads.
- JWTs, authorization headers, cookies, API keys, dispatch tokens, or session data.
- Private keys, certificates, CSIDs, secrets, encrypted credentials, or decrypted credentials.
- Raw request/response bodies, database rows, SQL, or error messages.

The correlation ID is diagnostic only and carries no business meaning.

## Collecting one checkout trace

1. Open browser developer tools and the Edge Function log stream before charging.
2. Perform exactly one controlled simplified/B2C checkout. Do not use a standard/B2B invoice for this trace.
3. In the browser console, filter for `[pos-checkout-perf]`.
4. Copy the `requestId` from `charge_clicked`.
5. Filter both browser and Edge logs by that exact `requestId`.
6. Order Edge records by `elapsedMs`. Repeated `signing_claim` records indicate claim contention.
7. Confirm the browser has `atomic_invoke_duration`, `response_received`,
   `receipt_state_created`, `success_screen_visible`, and `print_modal_ready`.
8. Confirm Edge has `atomic_commit_total` before `response_serialization` and
   `request_total`.
9. Analyze the largest `durationMs` spans. Do not infer time for work inside a
   combined span without additional instrumentation.

Reporting worker logs are intentionally outside this foreground trace.
Reporting may finish before or after the receipt becomes visible, but it is not
awaited by simplified checkout.

## Warm versus cold requests

Edge sets `coldStartCandidate=true` when the request starts within one second of
module/isolate initialization. This is a safe heuristic, not proof of a
platform cold start. Classify:

- `coldStartCandidate=true`: cold-start candidate cohort.
- `coldStartCandidate=false`: warm-candidate cohort.

Browser events always emit `coldStartCandidate=false` because browser module
age does not identify Edge isolate state. Use the Edge value for cohorting.
Keep cold and warm percentile reports separate, and retain the combined
distribution for user-observed latency.

## Calculating p50, p95, and p99

Collect a sufficient sample of complete traces under a consistent branch,
client version, network, and checkout scenario. Separate fresh checkout,
idempotent replay, signing-contention, cold-candidate, and warm-candidate
cohorts.

For each event or for `request_total`:

1. Extract valid numeric `durationMs` values from records with the desired
   event, status, and cohort.
2. Sort the values ascending.
3. For percentile `p`, use the nearest-rank index
   `ceil(p × N) - 1`, bounded to the array.
4. Report sample count alongside every percentile.

Example JavaScript:

```js
function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]
}

const p50 = percentile(durations, 0.50)
const p95 = percentile(durations, 0.95)
const p99 = percentile(durations, 0.99)
```

Do not calculate p99 from only a handful of requests. Prefer at least 100
observations for p99 and more when making rollout decisions.

## Behavior invariants

This instrumentation leaves the following unchanged:

- Simplified success still returns only after successful atomic commit and
  validation of a printable committed receipt.
- The durable reporting outbox is still inserted by the atomic commit.
- Reporting scheduling remains unawaited and uses the existing durable
  outbox/retry worker.
- XML construction, private-key decryption, signing, QR generation, artifact
  validation, chain allocation, and artifact storage execute in their original
  order with their original inputs and outputs.
- VAT, totals, invoice calculations, stock mutation, payment handling, invoice
  numbering, receipt snapshots, and commercial prepare/commit behavior are
  unchanged.
- Idempotency lookups, replay behavior, authorization, rate limiting,
  readiness, capability acknowledgement, and rollout enforcement are unchanged.
- Print remains enabled only by the existing committed receipt and stored QR
  readiness rules.
- Standard/B2B clearance gating and legacy checkout behavior are unchanged.
- Error classification and existing error response bodies are unchanged.

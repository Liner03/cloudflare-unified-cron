# Independent trigger delivery alongside RPC

Accepted for local implementation, 2026-09-12. Remote Free-plan capacity has not been certified.

One native minute Cron remains the only scheduler. Website-owned Registration supplies logical rules. The platform materializes a durable outbox and sends messages directly to a preauthorized per-website Queue. The website's queue handler owns business work, its runtime limits, retries, and atomic business deduplication. Queue acceptance ends the platform delivery operation; it does not mean business success.

Legacy RPC remains an explicit compatibility mode. It awaits business completion with the existing 30-second contract and preserves Execution/Attempt history. New Queue work uses `trigger_deliveries` so neither old readers nor success-rate calculations accidentally classify an accepted message as a succeeded business Execution. The console exposes a separate trigger ledger and optional terminal business receipts.

## Decisions

- `apps/platform/targets.json` owns physical Target allowlists. The sync tool checks/generates Service Bindings, Queue producer bindings and SQL. Registration never chooses a physical binding or callback URL.
- D1 `scheduler_settings` is the authoritative live capacity configuration. Migration defaults: 100 rules, 100 queue materializations/deliveries, 10 RPC calls, 5 RPC concurrency, 10 messages per website batch. These are bounded defaults, not throughput guarantees.
- Outbox occurrence insertion and Schedule advancement are one D1 transaction. Claim uses an expiring lease. Timeout or partial Queue acceptance becomes delivery `unknown`, retried no earlier than the next minute with the same identity.
- Queue mode accepts only idempotent registered Actions. The declaration is not an implementation of idempotency: consumers must couple business effects and stored results atomically, or use an upstream idempotency key.
- Business callbacks use a dedicated per-delivery capability derived with domain separation from `TRIGGER_SIGNING_KEY`. Only its hash is stored in D1. Never print message bodies or capabilities. The capability cannot publish Registration or access Admin APIs. Retain the signing key until pending deliveries drain; changing the key does not authorize inventing a new business identity.
- Stored terminal results are immutable except for exact replay. A lost callback is retried using the website's cached business result; it must not repeat business effects. No callback means “未上报”.
- Platform pause/Target disable/Schedule pause stop unclaimed deliveries. Already claimed or queued work may complete; pausing or purging a consumer is a separate, explicit operation. Business outcomes do not block future Queue occurrences. Sites that require no overlap implement that lock in their consumer's durable business state.
- A 3-second Queue send deadline bounds one site's unavailable producer binding. This is an ambiguous-delivery timeout, not a business deadline. RPC calls keep a separate budget. 30-day bounded cleanup removes terminal delivery rows; unresolved delivery records are retained for investigation.
- Delivery retries have priority by availability/creation within a site; small round-robin site batches and minute-rotated starting sites prevent one website from consuming all delivery slots. Coalesce/skip remains explicit and no per-minute outage replay loop is added.

## Evidence and platform constraints

Local workerd tests exercise three real RPC Entrypoints and three real Queue consumers with separate D1s. Ten-site driver tests exercise 10/25/50/100 simultaneous occurrences, identity, failure recovery, callback authorization, and 100-rule registration/listing. The example consumer transaction is tested with ten duplicate calls and a failed-then-successful callback.

The tests prove local behavior; simulated API timings do not prove Cloudflare CPU allowance. Before advertising 100/min on Free, measure production-equivalent queue/D1/Worker usage, burst delay, and repeated-load sustainability in authorized Staging.

Current provider documentation: [Queue send acknowledgement and batch limits](https://developers.cloudflare.com/queues/configuration/javascript-apis/), [RPC lifecycle](https://developers.cloudflare.com/workers/runtime-apis/rpc/lifecycle/), [Service Binding call limits](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/#limits), [Queue pricing](https://developers.cloudflare.com/queues/platform/pricing/).

At the documented nominal 3 Queue operations per successful message, 100 messages/hour is approximately 7,200 operations/day; 100/min is approximately 432,000/day before retries. Queue Free allowance cannot be presumed sufficient for the latter. No Paid upgrade is performed or required merely to configure logical rules.

## Migration and rollback

Apply migration 0006 before deploying code. Existing Targets remain RPC unless the deployer adds a `delivery` object. Drain/pause old RPC work before switching a Target. Removing a Queue binding never retracts already accepted messages.

Do not roll back to pre-0006 code while Queue Targets are enabled: it does not know to exclude them from RPC scheduling. Pause, drain outbox/queues, switch approved Targets back to RPC, then roll back only after compatibility checks. New migrations are additive; never clear D1 to downgrade. Old reports remain historical and cannot certify this implementation.

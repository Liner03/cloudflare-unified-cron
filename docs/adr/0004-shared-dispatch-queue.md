# ADR 0004: Shared dispatch Queue

Status: Accepted. Supersedes ADR 0003's per-Target Queue topology; its occurrence, idempotency and delivery/result separation decisions remain valid.

## Context

Per-Target Queues proved independent execution, but required one Queue, one DLQ, one website consumer and a reverse result path for every website. That is unnecessary infrastructure for a platform whose purpose is to replace many Cron Triggers with one scheduler.

Direct fan-out from `scheduled()` is also insufficient: it couples website latency to the Cron invocation and eventually reaches Worker-to-Worker invocation limits.

## Decision

Use one shared Queue. The Platform Worker is both producer and consumer. `scheduled()` materializes due occurrences and returns after durable acceptance. The Queue handler uses `max_batch_size=1`, resolves an allowlisted Target manifest and invokes exactly one website `CronEntrypoint.cron()` through its Service Binding.

The Delivery ID becomes RPC `executionId`. Infrastructure retries get a new `attemptId` and preserve the same business `idempotencyKey`. The Platform consumer writes the terminal result directly to Platform D1.

Website Workers no longer need Queue consumers, reverse Platform bindings or public callbacks. They retain the same SDK/RPC contract and business idempotency responsibility.

## Consequences

- One Cron, one Queue and one DLQ serve all logical schedules.
- Queue invocations, not the Cron invocation, contain website latency.
- Batch size one provides fault and latency isolation; Cloudflare controls consumer concurrency.
- Cross-Target routing remains limited to the generated manifest and Service Bindings.
- Queue operation pricing still scales with actual executions. A shared Queue reduces resources, not per-message operations.
- Adding websites still requires an allowlisted Service Binding deployment. Dynamic arbitrary Worker invocation is intentionally unsupported.

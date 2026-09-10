# Unified Cron Control

This context describes who declares recurring work, who may intervene, and how one declared occurrence becomes an auditable execution.

## Language

**Registrant Worker**:
A business Cloudflare Worker that owns and publishes its recurring-work declaration.
_Avoid_: Website, Web Worker, client

**Registration**:
The latest complete desired-state declaration accepted from one Registrant Worker.
_Avoid_: Event, form submission

**Managed Schedule**:
A recurring schedule whose declared configuration is owned by a Registration.
_Avoid_: Manually created cron

**Operator Override**:
A human-authored pause or disable decision that takes precedence over a Registration without changing it.
_Avoid_: Registration edit

**Effective Schedule**:
The schedule state after combining the Registration, Operator Overrides, Target availability, and the platform-wide dispatch switch.
_Avoid_: Enabled flag

**Local Administrator**:
The single trusted human identity allowed to observe the control plane and perform operator actions.
_Avoid_: Registration client, service account

**Admin Session**:
A short-lived browser login identity belonging to the Local Administrator.
_Avoid_: Registration Token

**Registration Token**:
A revocable machine credential bound to exactly one Registrant Worker and usable only to publish its Registration.
_Avoid_: Admin token, API superkey

**Retry**:
A new Attempt for the same Execution and idempotency key, permitted only when the safety policy allows it.
_Avoid_: Run again, rerun

**Run Again**:
A new Execution and idempotency key derived from an earlier Execution, with explicit duplicate-side-effect risk.
_Avoid_: Retry

**Execution Success Rate**:
The share of `succeeded` outcomes among `succeeded`, `failed`, and `unknown` Executions for a stated scope and time window.
_Avoid_: Availability, first-attempt rate

**First-Attempt Success Rate**:
The share of resolved Executions that succeeded on their first Attempt for a stated scope and time window.
_Avoid_: Execution Success Rate

# Self-registration and operator responsibility

## Responsibility split

The Local Administrator may:

- inspect Registrant Workers, Action capabilities, Managed Schedules, Executions, Attempts, results, and audit history;
- inspect Execution and first-attempt success rates with explicit windows and sample sizes;
- pause or resume a Managed Schedule without editing its declaration;
- disable or re-enable a Registrant Worker;
- Retry a safe Execution, Run Again with explicit risk, and resolve `unknown`;
- create, list, rotate, and revoke Registration Tokens;
- use the platform-wide emergency dispatch pause.

The Registrant Worker may only publish its own complete Registration. It owns Action names and versions, cron expressions, timezones, payloads, retry policies, deadlines, and whether a declared schedule is active. It cannot read operator data, invoke executions, issue credentials, or clear Operator Overrides.

## Authentication

V1 has one Local Administrator. The username is non-secret configuration and the password hash is a required Worker Secret. Login produces an opaque, revocable D1-backed Admin Session delivered in an HttpOnly, SameSite cookie. Production uses a Secure `__Host-` cookie; local development uses an equivalent non-Secure loopback cookie.

Registration Tokens contain at least 256 random bits, are displayed once, and are stored only as SHA-256 hashes. Each token is bound server-side to one physical Target, has an expiry, can be revoked, and has only `registration:write`. The raw token belongs in the Registrant Worker's Worker Secret.

Rotation creates a replacement Token and revokes the previous Token in one D1 transaction. The replacement raw value is also shown once; stored records retain `rotated_from` / `replaced_by` linkage for audit.

## Registration interface

```http
PUT /api/v1/registration
Authorization: Bearer <registration-token>
Idempotency-Key: <stable-key>
Content-Type: application/json
```

```json
{
  "registrationRevision": "build-or-git-sha",
  "worker": { "label": "Billing Worker" },
  "actions": [],
  "schedules": []
}
```

The target identity is derived from the token, never accepted from the body. Repeating the same revision and body is a no-op. Reusing a revision with a different body is a conflict. The application validates the whole document before applying it atomically.

Revision/hash bindings are retained permanently for the Target, not only for the current Registration. Republishing an exact historical declaration is a supported rollback; reusing its revision for different content is always rejected.

Each Managed Schedule has a stable `key`. Re-registration updates the matching declaration in place. A missing key becomes retired and stops producing new Executions; existing Execution snapshots and history remain. Reintroducing a key creates a new revision without erasing its operator override.

## Effective state

```text
declared active
AND NOT operator-paused
AND target enabled
AND NOT platform dispatch-paused
= eligible for materialization and dispatch
```

Schedule 列表与详情同时返回 `effectiveEnabled` 和 `blockingReasons`；后者会明确列出 `declared_disabled`、`operator_paused`、`target_disabled` 与 `dispatch_paused` 中所有当前原因。Overview 的 active 计数使用同一套有效状态语义。

No Registration write may modify `operator_paused`, target disablement, the global pause, an Execution, or an Attempt.

The platform has no Schedule Run-now operation. Retry keeps the same Execution and idempotency key; Run Again starts from a completed Execution with an explicit duplicate-side-effect warning. A paused, retired, or Worker-declared-disabled Schedule is not dispatch-eligible for queued or newly requested operator work.

## Success rates

Execution success rate is:

```text
succeeded / (succeeded + failed + unknown)
```

First-attempt success rate uses the same resolved population and counts only Executions that succeeded with `attempt_count = 1`. `skipped`, `cancelled`, and active states are excluded. Every rate includes its numerator, denominator, and 24-hour, 7-day, or 30-day window; a zero denominator is `null`, never `100%`.

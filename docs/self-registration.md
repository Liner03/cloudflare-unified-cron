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

Each Managed Schedule has a stable `key`. Re-registration updates the matching declaration in place. A missing key becomes retired and stops producing new Executions; existing Execution snapshots and history remain. Reintroducing a key creates a new revision without erasing its operator override.

## Effective state

```text
declared active
AND NOT operator-paused
AND target enabled
AND NOT platform dispatch-paused
= eligible for materialization and dispatch
```

No Registration write may modify `operator_paused`, target disablement, the global pause, an Execution, or an Attempt.

## Success rates

Execution success rate is:

```text
succeeded / (succeeded + failed + unknown)
```

First-attempt success rate uses the same resolved population and counts only Executions that succeeded with `attempt_count = 1`. `skipped`, `cancelled`, and active states are excluded. Every rate includes its numerator, denominator, and 24-hour, 7-day, or 30-day window; a zero denominator is `null`, never `100%`.

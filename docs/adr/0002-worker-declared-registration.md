# Worker-declared registration with local operator authentication

The platform will treat each Registrant Worker as the owner of a complete desired-state Registration containing its Action capabilities and Managed Schedules. A single Local Administrator authenticates with platform-owned credentials, issues revocable Registration Tokens, and applies Operator Overrides; Worker registration can never create its own trust, change physical Service Bindings, or clear an override. This keeps recurring configuration automated while preserving a human safety layer and the existing same-account Service Binding dispatch model.

## Considered Options

- Manual Schedule CRUD was rejected because it makes the control plane the source of business configuration.
- Cloudflare Access remains an optional outer perimeter, not the application authorization source.
- Arbitrary Worker URLs were rejected because they would replace the static same-account capability model with cross-account HTTP dispatch.

## Consequences

- A physical Target and Registration Token must be bootstrapped before a Worker can register.
- Registration is full desired-state reconciliation; omitted Managed Schedules retire without deleting execution history.
- Operator pause/disable state is stored separately and always wins over subsequent registrations.

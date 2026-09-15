# `@unified-cron/worker-sdk`

Worker-side adapter for Cloudflare Unified Cron. It keeps execution private over
Cloudflare Service Binding RPC and supplies the named `CronEntrypoint`, request
validation, deadline handling, error envelopes and self-registration helpers.

The GitHub Release archive embeds `@unified-cron/contracts`, so a target Worker
installs only one package. `zod` remains a normal transitive dependency.

## Install from GitHub Release

Pin an exact release URL:

```json
{
  "dependencies": {
    "@unified-cron/worker-sdk": "https://github.com/Liner03/cloudflare-unified-cron/releases/download/sdk-v0.1.0/unified-cron-worker-sdk-0.1.0.tgz"
  }
}
```

No GitHub token is needed for this public Release asset. Do not depend on a
moving branch or replace the versioned URL with `main`.

Runtime schemas and protocol types are available from the same package:

```ts
import type { CronRequestV1 } from "@unified-cron/worker-sdk/contracts";
```

See the repository
[Worker integration guide](https://github.com/Liner03/cloudflare-unified-cron/blob/main/docs/worker-integration.md)
for the complete `CronEntrypoint` and Registration example.

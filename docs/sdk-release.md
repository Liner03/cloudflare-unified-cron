# Worker SDK GitHub Release

The public Worker SDK is distributed as one versioned GitHub Release archive.
It is not published to npmjs or GitHub Packages. A public Release asset needs no
package-registry token and remains pinned by the tag and lockfile integrity.

The source stays split into `packages/contracts` and `packages/worker-sdk` for
the Platform workspace. `pnpm sdk:pack` compiles both and embeds the contracts
inside the released Worker SDK, exposed as
`@unified-cron/worker-sdk/contracts`.

## Build and verify

```bash
pnpm install --frozen-lockfile
pnpm sdk:pack
```

The command writes these ignored artifacts:

```text
artifacts/unified-cron-worker-sdk-0.1.0.tgz
artifacts/unified-cron-worker-sdk-0.1.0.tgz.sha256
```

The builder rejects mismatched workspace versions, remaining external
`@unified-cron/contracts` imports, test files in the archive, or missing public
entrypoints.

## Publish

Push an annotated tag matching the package version:

```bash
git tag -a sdk-v0.1.0 -m "sdk: release 0.1.0"
git push origin sdk-v0.1.0
```

The `release-sdk.yml` workflow runs the package tests, rebuilds the archive and
checksum from the tagged commit, and creates the GitHub Release.

## Consume

```json
{
  "dependencies": {
    "@unified-cron/worker-sdk": "https://github.com/Liner03/cloudflare-unified-cron/releases/download/sdk-v0.1.0/unified-cron-worker-sdk-0.1.0.tgz"
  }
}
```

Never use a branch archive as a dependency. A new SDK release requires a new
semantic version and tag; published tag contents must not be rewritten.

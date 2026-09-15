# Unified Cron Worker SDK 0.1.0

Initial GitHub Release of the Worker-side Service Binding RPC adapter.

- Named `CronEntrypoint` base for private Cloudflare Service Bindings.
- Versioned Action routing and runtime payload validation.
- Deadline, result-size and explicit retryable/permanent error handling.
- Registration client and Queue delivery helpers.
- Embedded V1 contracts and runtime schemas under the `./contracts` export.

Install using the versioned `.tgz` URL shown in the package README. This Release
does not create a public HTTP execution endpoint.

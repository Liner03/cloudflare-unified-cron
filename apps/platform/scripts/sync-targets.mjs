import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { z } from "zod";

const root = path.resolve(import.meta.dirname, "..");
const name = z.string().regex(/^[A-Z][A-Z0-9_]*$/);
const schema = z.array(
  z
    .object({
      id: name,
      label: z.string().min(1),
      binding: name,
      service: z.string().min(1),
      entrypoint: z.literal("CronEntrypoint"),
      protocolVersion: z.literal(1),
      manifestRevision: z.string().min(1),
      delivery: z
        .object({
          mode: z.literal("queue"),
          binding: name,
          queue: z.string().min(1),
        })
        .strict()
        .optional(),
    })
    .strict(),
);
const targets = schema.parse(
  JSON.parse(await fs.readFile(path.join(root, "targets.json"), "utf8")),
);
for (const values of [
  targets.map((t) => t.id),
  targets.map((t) => t.binding),
]) {
  if (new Set(values).size !== values.length)
    throw new Error("duplicate Target id, binding, or queue");
}
const configPath = path.join(
  root,
  process.argv.find((a) => a.startsWith("--config="))?.slice(9) ??
    "wrangler.jsonc",
);
const parsed = ts.parseConfigFileTextToJson(
  configPath,
  await fs.readFile(configPath, "utf8"),
);
if (parsed.error) throw new Error("Invalid Wrangler JSONC");
const config = parsed.config;
const services = targets.map((t) => ({
  binding: t.binding,
  service: t.service,
  entrypoint: t.entrypoint,
}));
const producers = [
  ...new Map(
    targets
      .filter((t) => t.delivery)
      .map((t) => [
        `${t.delivery.binding}:${t.delivery.queue}`,
        { binding: t.delivery.binding, queue: t.delivery.queue },
      ]),
  ).values(),
];
const quote = (s) => `'${s.replaceAll("'", "''")}'`;
const sql =
  targets
    .map(
      (t) =>
        `INSERT INTO targets (id,label,enabled,manifest_revision,created_at,updated_at) VALUES (${quote(t.id)},${quote(t.label)},1,${quote(t.manifestRevision)},unixepoch('subsec')*1000,unixepoch('subsec')*1000) ON CONFLICT(id) DO UPDATE SET label=excluded.label,manifest_revision=excluded.manifest_revision,updated_at=excluded.updated_at;`,
    )
    .join("\n") + "\n";
if (process.argv.includes("--write")) {
  config.services = services;
  config.queues = { ...config.queues, producers };
  if (producers.length)
    config.secrets = {
      ...config.secrets,
      required: [
        ...new Set([
          ...(config.secrets?.required ?? []),
          "TRIGGER_SIGNING_KEY",
        ]),
      ],
    };
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
  await fs.writeFile(path.join(root, "seed/targets.sql"), sql);
  console.log(
    "Updated Target bindings and idempotent SQL. Run platform types before building.",
  );
} else {
  const seed = await fs.readFile(path.join(root, "seed/targets.sql"), "utf8");
  if (
    JSON.stringify(config.services) !== JSON.stringify(services) ||
    JSON.stringify(config.queues?.producers ?? []) !==
      JSON.stringify(producers) ||
    targets.some(
      (t) =>
        !seed.includes(quote(t.id)) ||
        !seed.includes(quote(t.manifestRevision)),
    )
  )
    throw new Error("Target configuration drift; run pnpm targets:generate");
  console.log(
    `Target configuration checked: ${targets.length} targets, ${producers.length} queues`,
  );
}

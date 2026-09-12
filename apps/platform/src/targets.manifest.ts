import type { TargetManifest } from "@unified-cron/contracts";
import { targetManifestSchema } from "@unified-cron/contracts";
import source from "../targets.json";

export const TARGETS: TargetManifest[] = source.map((value) =>
  targetManifestSchema.parse(value),
);
for (const names of [
  TARGETS.map((target) => target.id),
  TARGETS.flatMap((target) => [
    target.binding,
    ...(target.delivery ? [target.delivery.binding] : []),
  ]),
  TARGETS.filter((target) => target.delivery).map(
    (target) => target.delivery!.queue,
  ),
]) {
  if (new Set(names).size !== names.length)
    throw new Error("DUPLICATE_TARGET_CONFIGURATION");
}

export function getTargetManifest(
  targetId: string,
): TargetManifest | undefined {
  return TARGETS.find((target) => target.id === targetId);
}

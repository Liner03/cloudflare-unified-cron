import type { TargetManifest } from "@unified-cron/contracts";
import { targetManifestSchema } from "@unified-cron/contracts";
import source from "../targets.json";

export const TARGETS: TargetManifest[] = source.map((value) =>
  targetManifestSchema.parse(value),
);
for (const names of [
  TARGETS.map((target) => target.id),
  TARGETS.map((target) => target.binding),
]) {
  if (new Set(names).size !== names.length)
    throw new Error("DUPLICATE_TARGET_CONFIGURATION");
}
const deliveryRoutes = new Set(
  TARGETS.filter((target) => target.delivery).map(
    (target) => `${target.delivery!.binding}:${target.delivery!.queue}`,
  ),
);
if (deliveryRoutes.size > 1) throw new Error("MULTIPLE_DISPATCH_QUEUES");

export function getTargetManifest(
  targetId: string,
): TargetManifest | undefined {
  return TARGETS.find((target) => target.id === targetId);
}

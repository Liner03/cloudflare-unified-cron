import type { TargetManifest } from "@unified-cron/contracts";

export const TARGETS = [
  {
    id: "DATA",
    label: "Data Worker",
    binding: "CRON_DATA",
    service: "worker-data",
    entrypoint: "CronEntrypoint",
    protocolVersion: 1,
    manifestRevision: "data-v1",
  },
] satisfies TargetManifest[];

export function getTargetManifest(
  targetId: string,
): TargetManifest | undefined {
  return TARGETS.find((target) => target.id === targetId);
}

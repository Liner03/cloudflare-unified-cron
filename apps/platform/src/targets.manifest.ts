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
    actions: [
      {
        name: "healthCheck",
        version: 1,
        label: "健康检查",
        description: "无副作用检查示例 Worker",
        idempotent: true,
        examplePayload: {},
      },
      {
        name: "syncUsers",
        version: 1,
        label: "同步用户",
        description: "展示业务侧持久化幂等的示例 Action",
        idempotent: true,
        examplePayload: { source: "crm" },
      },
    ],
  },
] satisfies TargetManifest[];

export function getTargetManifest(targetId: string): TargetManifest | undefined {
  return TARGETS.find((target) => target.id === targetId);
}

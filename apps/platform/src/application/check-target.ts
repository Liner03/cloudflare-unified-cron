import type {
  CronTargetDescriptionV1,
  TargetManifest,
} from "@unified-cron/contracts";
import { DomainError } from "../domain/error";
import { getTargetManifest } from "../targets.manifest";

export interface RegisteredActionReader {
  listActions(
    targetId: string,
  ): Promise<Array<{ name: string; version: number; idempotent: boolean }>>;
}

export interface TargetDescriptionPort {
  describe(target: TargetManifest): Promise<CronTargetDescriptionV1>;
}

export interface TargetCheckDecision {
  targetId: string;
  status: "compatible" | "incompatible" | "unreachable";
  message: string;
}

/** Compares deployed RPC capability with the Worker's authoritative declaration. */
export class TargetCheckApplication {
  constructor(
    private readonly actions: RegisteredActionReader,
    private readonly targets: TargetDescriptionPort,
  ) {}

  async run(targetId: string): Promise<TargetCheckDecision> {
    const target = getTargetManifest(targetId);
    if (!target) {
      throw new DomainError(
        "not_found",
        "TARGET_NOT_FOUND",
        "Target 不在部署白名单中",
      );
    }
    const registered = await this.actions.listActions(target.id);
    let remote: CronTargetDescriptionV1;
    try {
      remote = await this.targets.describe(target);
    } catch {
      return {
        targetId: target.id,
        status: "unreachable",
        message: "无法调用无副作用 describe() 或响应不合法",
      };
    }
    const compatible =
      registered.length > 0 &&
      registered.length === remote.actions.length &&
      registered.every((expected) =>
        remote.actions.some(
          (actual) =>
            actual.name === expected.name &&
            actual.version === expected.version &&
            actual.idempotent === expected.idempotent,
        ),
      );
    return {
      targetId: target.id,
      status: compatible ? "compatible" : "incompatible",
      message: compatible
        ? "RPC describe() 与最新 Registration 一致"
        : registered.length === 0
          ? "Target 尚未提交 Registration"
          : "RPC describe() 与最新 Registration 不一致",
    };
  }
}

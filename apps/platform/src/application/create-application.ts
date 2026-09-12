import type { Clock } from "../domain/model";
import { systemClock } from "../domain/model";
import { CronCalculator } from "../infrastructure/cron/cron-calculator";
import { ExecutionRepository } from "../infrastructure/d1/execution-repository";
import { RegisteredTargetCatalog } from "../infrastructure/d1/registered-target-catalog";
import { ServiceBindingAdapter } from "../infrastructure/rpc/service-binding-adapter";
import { TickApplication } from "./tick";
import { TriggerDeliveryApplication } from "./deliver-triggers";
import { TriggerDeliveryRepository } from "../infrastructure/d1/trigger-delivery-repository";
import { TARGETS } from "../targets.manifest";
import type { TargetManifest } from "@unified-cron/contracts";

export function createApplication(
  env: Env,
  clock: Clock = systemClock,
  manifest: readonly TargetManifest[] = TARGETS,
) {
  const targets = new RegisteredTargetCatalog(env.DB, manifest);
  const repository = new ExecutionRepository(
    env.DB,
    new CronCalculator(),
    targets,
  );
  return {
    repository,
    tick: new TickApplication(
      repository,
      targets,
      new ServiceBindingAdapter(env, manifest),
      clock,
      env.PLATFORM_INSTANCE_ID,
      env.BUILD_VERSION,
      new TriggerDeliveryApplication(
        new TriggerDeliveryRepository(env.DB),
        manifest,
        env,
        triggerSecret(env, manifest),
        env.PLATFORM_INSTANCE_ID,
      ),
    ),
  };
}

function triggerSecret(env: Env, manifest: readonly TargetManifest[]): string {
  if (!manifest.some((target) => target.delivery)) return "";
  const value: unknown = Reflect.get(env, "TRIGGER_SIGNING_KEY");
  if (typeof value !== "string" || value.length < 32)
    throw new Error("TRIGGER_SIGNING_KEY_REQUIRED");
  return value;
}

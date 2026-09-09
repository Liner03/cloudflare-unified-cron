import type { Clock } from "../domain/model";
import { systemClock } from "../domain/model";
import { CronCalculator } from "../infrastructure/cron/cron-calculator";
import { ExecutionRepository } from "../infrastructure/d1/execution-repository";
import { ServiceBindingAdapter } from "../infrastructure/rpc/service-binding-adapter";
import { TickApplication } from "./tick";

export function createApplication(env: Env, clock: Clock = systemClock) {
  const repository = new ExecutionRepository(env.DB, new CronCalculator());
  return {
    repository,
    tick: new TickApplication(
      repository,
      new ServiceBindingAdapter(env),
      clock,
      env.PLATFORM_INSTANCE_ID,
      env.BUILD_VERSION,
    ),
  };
}

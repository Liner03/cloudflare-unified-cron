import {
  assertCronResultIdentity,
  assertResultWithinLimits,
  cronTargetDescriptionV1Schema,
  cronResultV1Schema,
  type CronRequestV1,
  type CronResultV1,
  type TargetManifest,
} from "@unified-cron/contracts";
import type { CronEntrypointBase } from "@unified-cron/worker-sdk/entrypoint";

export class ServiceBindingAdapter {
  constructor(private readonly env: Env) {}

  async execute(
    target: TargetManifest,
    request: CronRequestV1,
  ): Promise<CronResultV1> {
    const binding = this.bindingFor(target.binding);
    const value = await Promise.resolve(binding.cron(request));
    const result = cronResultV1Schema.parse(value);
    assertCronResultIdentity(result, request);
    assertResultWithinLimits(result);
    return result;
  }

  async describe(target: TargetManifest) {
    return cronTargetDescriptionV1Schema.parse(
      await Promise.resolve(this.bindingFor(target.binding).describe()),
    );
  }

  private bindingFor(
    bindingName: string,
  ): Service<CronEntrypointBase<Record<string, never>>> {
    if (bindingName !== "CRON_DATA")
      throw new Error("TARGET_BINDING_NOT_CONFIGURED");
    return this.env.CRON_DATA as Service<
      CronEntrypointBase<Record<string, never>>
    >;
  }
}

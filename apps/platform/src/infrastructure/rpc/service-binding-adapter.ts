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
import { TARGETS } from "../../targets.manifest";

export class ServiceBindingAdapter {
  constructor(
    private readonly env: object,
    private readonly targets: readonly TargetManifest[] = TARGETS,
  ) {}

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
    if (!this.targets.some((target) => target.binding === bindingName))
      throw new Error("TARGET_BINDING_NOT_CONFIGURED");
    const binding: unknown = Reflect.get(this.env, bindingName);
    if (
      !binding ||
      typeof binding !== "object" ||
      typeof Reflect.get(binding, "cron") !== "function" ||
      typeof Reflect.get(binding, "describe") !== "function"
    )
      throw new Error("TARGET_BINDING_NOT_CONFIGURED");
    return binding as Service<CronEntrypointBase<Record<string, never>>>;
  }
}

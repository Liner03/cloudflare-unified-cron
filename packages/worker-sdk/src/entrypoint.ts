import { WorkerEntrypoint } from "cloudflare:workers";
export abstract class CronEntrypointBase<
  Env = Cloudflare.Env,
> extends WorkerEntrypoint<Env> {
  abstract cron(input: unknown): Promise<unknown>;
  abstract describe(): Promise<unknown>;
}

import { z } from "zod";
import { parseOrThrow } from "../http-support";
import { SystemRepository } from "../../infrastructure/d1/system-repository";
import { executeIdempotentMutation } from "../idempotent-mutation";
import { parseMutationBody } from "../request-body";
import type { ApiRouter } from "../router";

export function registerSystemRoutes(app: ApiRouter): void {
  for (const operation of ["pause", "resume"] as const) {
    app.post(`/system/${operation}`, async (context) => {
      const body = await parseMutationBody(context.req.raw);
      return executeIdempotentMutation(context, body.raw, () => {
        parseOrThrow(z.object({}).strict(), body.value);
        return new SystemRepository(context.env.DB).planDispatchState(
          operation,
          Date.now(),
        );
      });
    });
  }

  app.get("/system", async (context) => {
    return context.json(
      await new SystemRepository(context.env.DB).read(Date.now()),
    );
  });
}

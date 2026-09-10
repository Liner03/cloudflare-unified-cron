import { z } from "zod";
import { TargetCheckApplication } from "../../application/check-target";
import { ServiceBindingAdapter } from "../../infrastructure/rpc/service-binding-adapter";
import { RegisteredTargetCatalog } from "../../infrastructure/d1/registered-target-catalog";
import { TargetRepository } from "../../infrastructure/d1/target-repository";
import { parseOrThrow } from "../http-support";
import { executeIdempotentMutation } from "../idempotent-mutation";
import { parseMutationBody } from "../request-body";
import type { ApiRouter } from "../router";

export function registerTargetRoutes(app: ApiRouter): void {
  app.get("/targets", async (context) => {
    return context.json({
      data: await new TargetRepository(context.env.DB).list(),
    });
  });

  app.get("/targets/:id", async (context) => {
    return context.json({
      data: await new TargetRepository(context.env.DB).detail(
        context.req.param("id"),
      ),
    });
  });

  app.post("/targets/:id/check", async (context) => {
    const body = await parseMutationBody(context.req.raw);
    parseOrThrow(z.object({}), body.value);
    return executeIdempotentMutation(context, body.raw, async () => {
      const decision = await new TargetCheckApplication(
        new RegisteredTargetCatalog(context.env.DB),
        new ServiceBindingAdapter(context.env),
      ).run(context.req.param("id"));
      return new TargetRepository(context.env.DB).planRecordCheck({
        ...decision,
        now: Date.now(),
      });
    });
  });

  for (const operation of ["enable", "disable"] as const) {
    app.post(`/targets/:id/${operation}`, async (context) => {
      const body = await parseMutationBody(context.req.raw);
      parseOrThrow(z.object({}), body.value);
      return executeIdempotentMutation(context, body.raw, () => {
        return new TargetRepository(context.env.DB).planEnabledState(
          context.req.param("id"),
          operation,
          Date.now(),
        );
      });
    });
  }
}

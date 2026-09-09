import { z } from "zod";
import { RegistrationTokenRepository } from "../../infrastructure/d1/registration-token-repository";
import { parseOrThrow } from "../http-support";
import { parseMutationBody } from "../request-body";
import type { ApiRouter } from "../router";

const createTokenSchema = z
  .object({
    targetId: z.string().min(1).max(128),
    label: z.string().trim().min(1).max(100),
    expiresInDays: z.number().int().min(1).max(365).default(90),
  })
  .strict();

export function registerRegistrationTokenRoutes(app: ApiRouter): void {
  app.get("/registration-tokens", async (context) => {
    const tokens = await new RegistrationTokenRepository(context.env.DB).list();
    return context.json({ data: tokens });
  });

  app.post("/registration-tokens", async (context) => {
    const body = await parseMutationBody(context.req.raw);
    const input = parseOrThrow(createTokenSchema, body.value);
    const token = await new RegistrationTokenRepository(context.env.DB).issue({
      ...input,
      actor: context.get("actor"),
      now: Date.now(),
    });
    return context.json({ data: token });
  });

  app.post("/registration-tokens/:id/revoke", async (context) => {
    const body = await parseMutationBody(context.req.raw);
    parseOrThrow(z.object({}).strict(), body.value);
    const result = await new RegistrationTokenRepository(context.env.DB).revoke(
      {
        id: context.req.param("id"),
        actor: context.get("actor"),
        now: Date.now(),
      },
    );
    return context.json({ data: result });
  });
}

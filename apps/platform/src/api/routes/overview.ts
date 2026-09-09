import type { ApiRouter } from "../router";
import { OverviewRepository } from "../../infrastructure/d1/overview-repository";

export function registerOverviewRoutes(app: ApiRouter): void {
  app.get("/overview", async (context) => {
    return context.json(
      await new OverviewRepository(context.env.DB).read(Date.now()),
    );
  });
}

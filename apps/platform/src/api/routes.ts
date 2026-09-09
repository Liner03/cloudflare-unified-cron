import { ApiError, errorResponse } from "./errors";
import { createApiRouter } from "./router";
import { registerExecutionRoutes } from "./routes/executions";
import { registerOverviewRoutes } from "./routes/overview";
import { registerScheduleRoutes } from "./routes/schedules";
import { registerSystemRoutes } from "./routes/system";
import { registerTargetRoutes } from "./routes/targets";
import {
  authenticate,
  enforceMutationRequest,
} from "../infrastructure/auth/access";

const app = createApiRouter();

app.use("*", authenticate);
app.use("*", async (context, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(context.req.method)) {
    enforceMutationRequest(context.req.raw, context.env.PUBLIC_ORIGIN);
  }
  await next();
  context.res.headers.set("Cache-Control", "no-store");
  context.res.headers.set("X-Content-Type-Options", "nosniff");
  context.res.headers.set("Referrer-Policy", "same-origin");
  context.res.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
  );
});

app.onError((error, context) =>
  errorResponse(error, context.get("requestId") ?? crypto.randomUUID()),
);

registerOverviewRoutes(app);
registerScheduleRoutes(app);
registerTargetRoutes(app);
registerExecutionRoutes(app);
registerSystemRoutes(app);

app.all("*", () => {
  throw new ApiError(404, "NOT_FOUND", "API endpoint not found");
});

export { app as api };

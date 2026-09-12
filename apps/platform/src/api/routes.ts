import { ApiError, errorResponse } from "./errors";
import { createApiRouter } from "./router";
import { registerExecutionRoutes } from "./routes/executions";
import { registerOverviewRoutes } from "./routes/overview";
import { registerScheduleRoutes } from "./routes/schedules";
import { registerSystemRoutes } from "./routes/system";
import { registerTargetRoutes } from "./routes/targets";
import { registerAuthRoutes } from "./routes/auth";
import { registerRegistrationTokenRoutes } from "./routes/registration-tokens";
import { registerWorkerRegistrationRoute } from "./routes/registration";
import { registerSuccessRateRoutes } from "./routes/success-rates";
import {
  authenticate,
  enforceMutationRequest,
} from "../infrastructure/auth/access";
import { requireIdempotencyKey } from "./idempotent-mutation";
import {
  registerDeliveryReceiptRoute,
  registerDeliveryRoutes,
} from "./routes/deliveries";

const app = createApiRouter();

app.use("*", async (context, next) => {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  context.set("requestId", requestId);
  await next();
  context.res.headers.set("Cache-Control", "no-store");
  context.res.headers.set("X-Content-Type-Options", "nosniff");
  context.res.headers.set("Referrer-Policy", "same-origin");
  context.res.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
  );
  console.log(
    JSON.stringify({
      event: "api_request",
      requestId,
      method: context.req.method,
      path: new URL(context.req.url).pathname,
      status: context.res.status,
      buildVersion: context.env.BUILD_VERSION,
      durationMs: Date.now() - startedAt,
    }),
  );
});

app.onError((error, context) =>
  errorResponse(error, context.get("requestId") ?? crypto.randomUUID()),
);

registerAuthRoutes(app);
registerWorkerRegistrationRoute(app);
registerDeliveryReceiptRoute(app);

app.use("*", authenticate);
app.use("*", async (context, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(context.req.method)) {
    enforceMutationRequest(context.req.raw, context.env);
    requireIdempotencyKey(context.req.raw);
  }
  await next();
});

registerOverviewRoutes(app);
registerScheduleRoutes(app);
registerTargetRoutes(app);
registerExecutionRoutes(app);
registerSystemRoutes(app);
registerRegistrationTokenRoutes(app);
registerSuccessRateRoutes(app);
registerDeliveryRoutes(app);

app.all("*", () => {
  throw new ApiError(404, "NOT_FOUND", "API endpoint not found");
});

export { app as api };

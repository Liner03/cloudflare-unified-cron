import { api } from "./api/routes";
import { createApplication } from "./application/create-application";
import { consumeDispatchQueue } from "./application/consume-dispatch-queue";

export default {
  fetch(request, env, ctx) {
    return api.fetch(request, env, ctx);
  },
  async scheduled(controller, env) {
    await createApplication(env).tick.run(controller.scheduledTime);
  },
  queue: consumeDispatchQueue,
} satisfies ExportedHandler<Env>;

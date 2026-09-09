import {
  BoundedJsonError,
  readBoundedJson,
  workerRegistrationV1Schema,
  type WorkerRegistrationV1,
  type WorkerRegistrationV1Input,
} from "@unified-cron/contracts";
import { z } from "zod";

const registrationResponseSchema = z.object({
  data: z.object({
    targetId: z.string(),
    registrationRevision: z.string(),
    unchanged: z.boolean(),
    actions: z.number().int().min(0),
    schedules: z.number().int().min(0),
    retiredSchedules: z.number().int().min(0),
    registeredAt: z.iso.datetime(),
  }),
});

const registrationErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
  }),
});

const REGISTRATION_RESPONSE_LIMIT_BYTES = 64 * 1024;

export type RegistrationResult = z.infer<
  typeof registrationResponseSchema
>["data"];

export class RegistrationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "RegistrationError";
  }
}

export interface RegistrationClient {
  register(declaration: WorkerRegistrationV1Input): Promise<RegistrationResult>;
}

/** Creates a write-only client for publishing this Worker's complete desired state. */
export function createRegistrationClient(options: {
  endpoint: string;
  token: string;
  fetcher?: typeof fetch;
}): RegistrationClient {
  const endpoint = validateRegistrationEndpoint(options.endpoint);
  if (!/^ucrt_[A-Za-z0-9_-]{43}$/.test(options.token)) {
    throw new Error("Registration token has an invalid format");
  }
  const fetcher = options.fetcher ?? fetch;
  return {
    async register(value) {
      const declaration = workerRegistrationV1Schema.parse(value);
      const response = await fetcher(endpoint, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${options.token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": await registrationIdempotencyKey(declaration),
        },
        body: JSON.stringify(declaration),
      });
      const body = await readRegistrationResponse(response);
      if (!response.ok) {
        const parsed = registrationErrorSchema.safeParse(body);
        throw new RegistrationError(
          response.status,
          parsed.success ? parsed.data.error.code : "REGISTRATION_FAILED",
          parsed.success
            ? parsed.data.error.message
            : `Registration failed with HTTP ${response.status}`,
          parsed.success ? parsed.data.error.requestId : null,
        );
      }
      const parsed = registrationResponseSchema.safeParse(body);
      if (!parsed.success) {
        throw new RegistrationError(
          response.status,
          "INVALID_REGISTRATION_RESPONSE",
          "Registration endpoint returned an incompatible response",
          null,
        );
      }
      return parsed.data.data;
    },
  };
}

function validateRegistrationEndpoint(value: string): string {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("Registration endpoint must use HTTPS");
  }
  if (url.username || url.password || url.hash) {
    throw new Error(
      "Registration endpoint must not contain credentials or a hash",
    );
  }
  return url.toString();
}

async function registrationIdempotencyKey(
  declaration: WorkerRegistrationV1,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      `${declaration.registrationRevision}:${JSON.stringify(declaration)}`,
    ),
  );
  const suffix = Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `registration:${suffix}`;
}

async function readRegistrationResponse(response: Response): Promise<unknown> {
  try {
    return (
      await readBoundedJson({
        body: response.body,
        contentLength: response.headers.get("Content-Length"),
        maxBytes: REGISTRATION_RESPONSE_LIMIT_BYTES,
      })
    ).value;
  } catch (error) {
    if (error instanceof BoundedJsonError && error.reason === "too_large") {
      throw new RegistrationError(
        response.status,
        "REGISTRATION_RESPONSE_TOO_LARGE",
        "Registration response exceeded 64 KiB",
        null,
      );
    }
    if (error instanceof BoundedJsonError) {
      throw new RegistrationError(
        response.status,
        "INVALID_REGISTRATION_RESPONSE",
        "Registration endpoint returned invalid JSON",
        null,
      );
    }
    throw error;
  }
}

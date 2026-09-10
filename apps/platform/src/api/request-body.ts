import {
  BoundedJsonError,
  LIMITS,
  readBoundedJson,
} from "@unified-cron/contracts";
import { ApiError } from "./errors";

export async function parseMutationBody(request: Request): Promise<{
  raw: Uint8Array;
  value: unknown;
}> {
  try {
    const result = await readBoundedJson({
      body: request.body,
      contentLength: request.headers.get("Content-Length"),
      maxBytes: LIMITS.requestBodyBytes,
    });
    return { raw: result.raw, value: result.value ?? {} };
  } catch (error) {
    if (error instanceof BoundedJsonError && error.reason === "too_large") {
      throw new ApiError(413, "REQUEST_TOO_LARGE", "请求体不得超过 64 KiB");
    }
    if (error instanceof BoundedJsonError) {
      throw new ApiError(422, "INVALID_JSON", "请求体不是有效 UTF-8 JSON");
    }
    throw error;
  }
}

import { LIMITS } from "@unified-cron/contracts";
import { ApiError } from "./errors";

export async function parseMutationBody(request: Request): Promise<{
  raw: Uint8Array;
  value: unknown;
}> {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > LIMITS.requestBodyBytes) {
    throw new ApiError(413, "REQUEST_TOO_LARGE", "请求体不得超过 64 KiB");
  }
  const reader = request.body?.getReader();
  if (!reader) return { raw: new Uint8Array(), value: {} };
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > LIMITS.requestBodyBytes) {
      await reader.cancel("request too large");
      throw new ApiError(413, "REQUEST_TOO_LARGE", "请求体不得超过 64 KiB");
    }
    chunks.push(chunk.value);
  }
  const raw = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    return { raw, value: text.length === 0 ? {} : JSON.parse(text) };
  } catch {
    throw new ApiError(422, "INVALID_JSON", "请求体不是有效 UTF-8 JSON");
  }
}

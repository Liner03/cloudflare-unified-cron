export type BoundedJsonErrorReason = "too_large" | "invalid_json";

export class BoundedJsonError extends Error {
  constructor(readonly reason: BoundedJsonErrorReason) {
    super(reason);
    this.name = "BoundedJsonError";
  }
}

export interface BoundedJsonResult {
  raw: Uint8Array;
  value: unknown;
}

/** Reads and decodes a JSON body without trusting Content-Length. */
export async function readBoundedJson(input: {
  body: ReadableStream<Uint8Array> | null;
  contentLength: string | null;
  maxBytes: number;
}): Promise<BoundedJsonResult> {
  const declared = Number(input.contentLength);
  if (Number.isFinite(declared) && declared > input.maxBytes) {
    throw new BoundedJsonError("too_large");
  }
  const reader = input.body?.getReader();
  if (!reader) return { raw: new Uint8Array(), value: null };
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > input.maxBytes) {
      await reader.cancel("body too large");
      throw new BoundedJsonError("too_large");
    }
    chunks.push(chunk.value);
  }
  const raw = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (raw.byteLength === 0) return { raw, value: null };
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    return { raw, value: JSON.parse(text) };
  } catch {
    throw new BoundedJsonError("invalid_json");
  }
}

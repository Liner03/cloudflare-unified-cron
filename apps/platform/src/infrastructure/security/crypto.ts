export async function sha256(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await sha256(value);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

interface TimingSafeSubtleCrypto extends SubtleCrypto {
  timingSafeEqual(left: BufferSource, right: BufferSource): boolean;
}

export function timingSafeEqual(
  left: BufferSource,
  right: BufferSource,
): boolean {
  const subtle = crypto.subtle;
  if (!hasTimingSafeEqual(subtle)) {
    throw new Error("TIMING_SAFE_EQUAL_UNAVAILABLE");
  }
  return subtle.timingSafeEqual(left, right);
}

function hasTimingSafeEqual(
  subtle: SubtleCrypto,
): subtle is TimingSafeSubtleCrypto {
  return typeof Reflect.get(subtle, "timingSafeEqual") === "function";
}

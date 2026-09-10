export type DomainErrorKind =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "too_large"
  | "invalid"
  | "rate_limited"
  | "unavailable";

export type ErrorDetails = Record<string, string | number | boolean | null>;

/** A transport-neutral expected failure raised by domain and persistence modules. */
export class DomainError extends Error {
  constructor(
    readonly kind: DomainErrorKind,
    readonly code: string,
    message: string,
    readonly details?: ErrorDetails,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

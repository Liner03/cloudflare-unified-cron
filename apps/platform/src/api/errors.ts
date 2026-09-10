import { DomainError, type DomainErrorKind } from "../domain/error";

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 503,
    readonly code: string,
    message: string,
    readonly details?: Record<string, string | number | boolean | null>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorResponse(error: unknown, requestId: string): Response {
  const apiError =
    error instanceof ApiError
      ? error
      : error instanceof DomainError
        ? new ApiError(
            statusForDomainError(error.kind),
            error.code,
            error.message,
            error.details,
          )
        : new ApiError(
            503,
            "PLATFORM_UNAVAILABLE",
            "平台状态暂时不可用，请稍后重试",
          );
  if (!(error instanceof ApiError) && !(error instanceof DomainError)) {
    console.error(
      JSON.stringify({
        event: "api_unhandled_error",
        requestId,
        errorCode: "PLATFORM_UNAVAILABLE",
      }),
    );
  }
  return Response.json(
    {
      error: {
        code: apiError.code,
        message: apiError.message,
        requestId,
        ...(apiError.details === undefined
          ? {}
          : { details: apiError.details }),
      },
    },
    {
      status: apiError.status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

function statusForDomainError(kind: DomainErrorKind): ApiError["status"] {
  const status = {
    unauthenticated: 401,
    forbidden: 403,
    not_found: 404,
    conflict: 409,
    too_large: 413,
    invalid: 422,
    rate_limited: 429,
    unavailable: 503,
  } as const;
  return status[kind];
}

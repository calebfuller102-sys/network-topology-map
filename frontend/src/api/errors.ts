export interface ApiErrorInfo {
  code: string;
  message: string;
}

interface ValidationDetail {
  loc?: unknown;
  message?: unknown;
  msg?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validationMessage(detail: ValidationDetail[]): string | null {
  const messages = detail
    .slice(0, 3)
    .flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }
      const detailMessage = typeof item.message === "string"
        ? item.message
        : typeof item.msg === "string"
          ? item.msg
          : null;
      if (!detailMessage) {
        return [];
      }
      const location = Array.isArray(item.loc)
        ? item.loc
          .filter((part): part is string | number => (typeof part === "string" || typeof part === "number") && part !== "body")
          .join(" → ")
        : "";
      return [location ? `${location}: ${detailMessage}` : detailMessage];
    });
  return messages.length > 0 ? messages.join("; ") : null;
}

/**
 * FastAPI uses a `detail` array for request validation while application
 * errors use the project's `{ error: { code, message } }` envelope. Convert
 * both into a safe short message that form controls can show directly.
 */
export function apiErrorInfo(payload: unknown, status: number): ApiErrorInfo {
  if (isRecord(payload)) {
    const error = payload.error;
    if (isRecord(error)) {
      if (Array.isArray(error.details)) {
        const message = validationMessage(error.details as ValidationDetail[]);
        if (message) {
          return {
            code: typeof error.code === "string" ? error.code : "validation_error",
            message,
          };
        }
      }
      if (typeof error.message === "string") {
        return {
          code: typeof error.code === "string" ? error.code : "request_failed",
          message: error.message,
        };
      }
    }

    if (typeof payload.detail === "string") {
      return { code: "validation_error", message: payload.detail };
    }

    if (Array.isArray(payload.detail)) {
      const message = validationMessage(payload.detail as ValidationDetail[]);
      if (message) {
        return { code: "validation_error", message };
      }
    }
  }

  return {
    code: "request_failed",
    message: `Request failed with status ${status}`,
  };
}

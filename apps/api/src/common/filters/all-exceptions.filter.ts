import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import * as Sentry from "@sentry/node";
import type { Request, Response } from "express";

/** The API's normalized error envelope (matches the ValidationPipe factory in main.ts). */
interface ErrorEnvelope {
  statusCode: number;
  code: string;
  message: string;
  errors?: unknown;
}

/**
 * Global exception filter. The default Nest filter neither normalizes the error
 * envelope nor reports uncaught throws, so this fills both gaps:
 *
 *   1. EVERY error leaves as `{ statusCode, code, message }`. HttpException bodies
 *      that already carry a `code` (the whole codebase throws these) pass through
 *      unchanged; unknown throws collapse to a generic 500 that NEVER leaks the
 *      stack/internal message to the client.
 *   2. Unexpected errors (>= 500 / non-HttpException) are auto-captured to Sentry,
 *      so a throw in an un-instrumented handler is no longer invisible. Expected
 *      client errors (4xx) are not reported.
 *
 * Scope is HTTP only: GraphQL has its own Apollo `formatError` masking, so
 * non-HTTP contexts are re-thrown untouched.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("AllExceptionsFilter");

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== "http") {
      // Let GraphQL/WS pipelines handle their own errors.
      throw exception;
    }

    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const envelope = this.normalize(exception);

    if (envelope.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      Sentry.captureException(exception, {
        level: "error",
        tags: {
          component: "http",
          method: req?.method,
          path: req?.route?.path ?? req?.url,
        },
      });
      this.logger.error(
        `${req?.method ?? "?"} ${req?.url ?? "?"} -> ${envelope.statusCode} ${envelope.code}: ${
          exception instanceof Error
            ? (exception.stack ?? exception.message)
            : String(exception)
        }`,
      );
    }

    if (res.headersSent) {
      return;
    }
    res.status(envelope.statusCode).json({
      statusCode: envelope.statusCode,
      code: envelope.code,
      message: envelope.message,
      ...(envelope.errors !== undefined ? { errors: envelope.errors } : {}),
    });
  }

  private normalize(exception: unknown): ErrorEnvelope {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === "string") {
        return {
          statusCode: status,
          code: fallbackCode(status),
          message: body,
        };
      }
      const obj = (body ?? {}) as Record<string, unknown>;
      const rawMessage = obj.message;
      return {
        statusCode: status,
        code:
          typeof obj.code === "string" && obj.code
            ? obj.code
            : fallbackCode(status),
        message:
          typeof rawMessage === "string" && rawMessage
            ? rawMessage
            : Array.isArray(rawMessage)
              ? rawMessage.join(", ")
              : fallbackMessage(status),
        errors: obj.errors,
      };
    }
    // Unknown/unexpected throw: never surface internals to the client.
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    };
  }
}

/** Map an HTTP status to a stable snake_case-ish fallback code. */
function fallbackCode(status: number): string {
  const known: Record<number, string> = {
    [HttpStatus.BAD_REQUEST]: "BAD_REQUEST",
    [HttpStatus.UNAUTHORIZED]: "UNAUTHORIZED",
    [HttpStatus.FORBIDDEN]: "FORBIDDEN",
    [HttpStatus.NOT_FOUND]: "NOT_FOUND",
    [HttpStatus.CONFLICT]: "CONFLICT",
    [HttpStatus.TOO_MANY_REQUESTS]: "RATE_LIMITED",
  };
  return known[status] ?? (status >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR");
}

function fallbackMessage(status: number): string {
  return status >= HttpStatus.INTERNAL_SERVER_ERROR
    ? "Internal server error"
    : "Request failed";
}

import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { Prisma } from "@ecom/db";
import type { Response } from "express";
import type { ApiError } from "@ecom/shared";

/** Normalizes every error into the ApiError shape from @ecom/shared. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("Exceptions");

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const body = this.toApiError(exception);
    if (body.statusCode >= 500) this.logger.error(exception);
    res.status(body.statusCode).json(body);
  }

  private toApiError(exception: unknown): ApiError {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const r = typeof response === "string" ? { message: response } : (response as Record<string, unknown>);
      return {
        statusCode: status,
        error: HttpStatus[status] ?? "Error",
        message: Array.isArray(r.message) ? r.message.join(", ") : String(r.message ?? exception.message),
        details: r.details,
      };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === "P2002") {
        const target = (exception.meta?.target as string[] | undefined)?.join(", ") ?? "field";
        return { statusCode: 409, error: "CONFLICT", message: `A record with this ${target} already exists` };
      }
      if (exception.code === "P2025") {
        return { statusCode: 404, error: "NOT_FOUND", message: "Record not found" };
      }
      if (exception.code === "P2003") {
        return { statusCode: 400, error: "BAD_REQUEST", message: "Referenced record does not exist" };
      }
    }
    return { statusCode: 500, error: "INTERNAL_SERVER_ERROR", message: "Something went wrong" };
  }
}

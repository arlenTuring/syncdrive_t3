import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';

/** Preserve endpoint-specific codes; normalize Nest validation failures. */
@Catch(HttpException)
export class OrderErrorFilter implements ExceptionFilter {
  catch(error: HttpException, host: ArgumentsHost) {
    const statusCode = error.getStatus();
    const raw = error.getResponse();
    const body = typeof raw === 'string' ? { message: raw } : raw as Record<string, unknown>;
    host.switchToHttp().getResponse<Response>().status(statusCode).json({
      statusCode,
      code: body.code ?? ({ 400: 'INVALID_REQUEST', 401: 'INVALID_API_KEY', 403: 'VEHICLE_NOT_AUTHORIZED', 404: 'RESOURCE_NOT_FOUND', 409: 'ORDER_ALREADY_EXISTS' } as Record<number, string>)[statusCode] ?? 'REQUEST_FAILED',
      message: body.message ?? error.message,
    });
  }
}

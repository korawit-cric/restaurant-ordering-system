import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Prisma } from '@repo/prisma';
import type { Response } from 'express';
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaFilter implements ExceptionFilter {
  catch(error: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const status =
      error.code === 'P2025'
        ? 404
        : ['P2002', 'P2003', 'P2034'].includes(error.code)
          ? 409
          : 500;
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json({
        message:
          status === 404
            ? 'Record not found'
            : status === 409
              ? 'The record changed or conflicts with an existing record. Refresh and try again.'
              : 'Database request failed. Retry the same request.',
      });
  }
}

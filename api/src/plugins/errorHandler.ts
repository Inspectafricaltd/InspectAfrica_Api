import type { FastifyInstance, FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';

interface ApiError {
  code: string;
  message: string;
  field?: string;
}

interface ErrorResponse {
  data: null;
  error: ApiError;
}

function formatError(error: unknown): ErrorResponse {
  // Zod validation errors
  if (error instanceof ZodError) {
    const firstError = error.errors[0];
    if (!firstError) {
      return {
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
        },
      };
    }
    return {
      data: null,
      error: {
        code: 'VALIDATION_ERROR',
        message: firstError.message,
        field: firstError.path.join('.'),
      },
    };
  }

  // Fastify HTTP errors
  if (isFastifyError(error)) {
    const statusCode = error.statusCode || 500;
    
    // Map status codes to error codes
    const codeMap: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'RATE_LIMITED',
      500: 'INTERNAL_ERROR',
    };

    return {
      data: null,
      error: {
        code: codeMap[statusCode] || 'ERROR',
        message: error.message,
      },
    };
  }

  // Prisma errors
  if (isPrismaError(error)) {
    const prismaError = error as PrismaError;
    
    switch (prismaError.code) {
      case 'P2002':
        return {
          data: null,
          error: {
            code: 'CONFLICT',
            message: 'A record with this value already exists',
            field: prismaError.meta?.target as string,
          },
        };
      case 'P2025':
        return {
          data: null,
          error: {
            code: 'NOT_FOUND',
            message: 'Record not found',
          },
        };
      default:
        return {
          data: null,
          error: {
            code: 'DATABASE_ERROR',
            message: 'A database error occurred',
          },
        };
    }
  }

  // Unknown errors - sanitize for production
  return {
    data: null,
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production' 
        ? 'An unexpected error occurred' 
        : (error as Error).message || 'Unknown error',
    },
  };
}

function isFastifyError(error: unknown): error is FastifyError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    'message' in error
  );
}

interface PrismaError extends Error {
  code: string;
  meta?: { target?: string | string[] };
}

function isPrismaError(error: unknown): error is PrismaError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as any).code === 'string' &&
    (error as any).code.startsWith('P')
  );
}

async function errorHandlerPlugin(fastify: FastifyInstance) {
  fastify.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const context: Record<string, unknown> = {
      method: request.method,
      url: request.url,
      userId: user?.id,
      role: user?.role,
      params: request.params,
    };

    const response = formatError(error);
    const statusCode = isFastifyError(error)
      ? error.statusCode || 500
      : 500;

    if (statusCode >= 500) {
      request.log.error({ err: error, ...context }, 'server error');
    } else if (statusCode >= 400) {
      request.log.warn({ err: error, ...context }, 'client error');
    }

    return reply.status(statusCode).send(response);
  });
}

export default fp(errorHandlerPlugin, {
  name: 'errorHandler',
});

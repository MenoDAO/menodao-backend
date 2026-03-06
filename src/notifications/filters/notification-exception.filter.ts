import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';

/**
 * Error response format for consistent error handling
 * Requirements: 5.4, 7.2, 7.4
 */
interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: string;
}

/**
 * Global exception filter for notification system
 * Handles all error types with consistent response format
 * Requirements: 5.4, 7.2, 7.4
 */
@Catch()
export class NotificationExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(NotificationExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    let status: number;
    let errorResponse: ErrorResponse;

    // Handle different error types
    if (exception instanceof ThrottlerException) {
      // Rate limiting errors (429)
      status = HttpStatus.TOO_MANY_REQUESTS;
      errorResponse = this.handleRateLimitError(exception);
    } else if (exception instanceof HttpException) {
      // HTTP exceptions (validation, authentication, etc.)
      status = exception.getStatus();
      errorResponse = this.handleHttpException(exception, status);
    } else if (this.isPrismaError(exception)) {
      // Database errors
      const result = this.handleDatabaseError(exception as any);
      status = result.status;
      errorResponse = result.errorResponse;
    } else if (this.isExternalServiceError(exception)) {
      // External service errors (SMS, Push services)
      const result = this.handleExternalServiceError(exception as Error);
      status = result.status;
      errorResponse = result.errorResponse;
    } else {
      // Unknown errors
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      errorResponse = this.handleUnknownError(exception);
    }

    // Log error details
    this.logger.error(
      `${request.method} ${request.url} - Status: ${status}`,
      exception instanceof Error ? exception.stack : JSON.stringify(exception),
    );

    // Send error response
    response.status(status).json(errorResponse);
  }

  /**
   * Handle rate limiting errors (429)
   * Requirements: 7.4
   */
  private handleRateLimitError(exception: ThrottlerException): ErrorResponse {
    return {
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message:
          'Rate limit exceeded. Maximum 10 bulk sends per hour. Try again later.',
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Handle HTTP exceptions (validation, authentication, etc.)
   * Requirements: 5.4, 7.2
   */
  private handleHttpException(
    exception: HttpException,
    status: number,
  ): ErrorResponse {
    const exceptionResponse = exception.getResponse();
    const message =
      typeof exceptionResponse === 'string'
        ? exceptionResponse
        : (exceptionResponse as any).message || exception.message;

    // Handle specific HTTP status codes
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: Array.isArray(message) ? message.join(', ') : message,
            details:
              typeof exceptionResponse === 'object' ? exceptionResponse : null,
          },
          timestamp: new Date().toISOString(),
        };

      case HttpStatus.UNAUTHORIZED:
        return {
          success: false,
          error: {
            code: 'AUTHENTICATION_ERROR',
            message: message || 'Authentication required',
          },
          timestamp: new Date().toISOString(),
        };

      case HttpStatus.FORBIDDEN:
        return {
          success: false,
          error: {
            code: 'AUTHORIZATION_ERROR',
            message: message || 'Insufficient permissions',
          },
          timestamp: new Date().toISOString(),
        };

      case HttpStatus.NOT_FOUND:
        return {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: message || 'Resource not found',
          },
          timestamp: new Date().toISOString(),
        };

      default:
        return {
          success: false,
          error: {
            code: 'HTTP_ERROR',
            message: message || 'An error occurred',
          },
          timestamp: new Date().toISOString(),
        };
    }
  }

  /**
   * Handle database errors (500, 504)
   * Requirements: 7.4
   */
  private handleDatabaseError(exception: any): {
    status: number;
    errorResponse: ErrorResponse;
  } {
    // Prisma-specific errors
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return {
            status: HttpStatus.CONFLICT,
            errorResponse: {
              success: false,
              error: {
                code: 'DUPLICATE_ENTRY',
                message: 'A record with this data already exists',
                details: exception.meta,
              },
              timestamp: new Date().toISOString(),
            },
          };

        case 'P2003':
          return {
            status: HttpStatus.BAD_REQUEST,
            errorResponse: {
              success: false,
              error: {
                code: 'FOREIGN_KEY_VIOLATION',
                message: 'Invalid reference to related data',
                details: exception.meta,
              },
              timestamp: new Date().toISOString(),
            },
          };

        case 'P2025':
          return {
            status: HttpStatus.NOT_FOUND,
            errorResponse: {
              success: false,
              error: {
                code: 'RECORD_NOT_FOUND',
                message: 'The requested record was not found',
              },
              timestamp: new Date().toISOString(),
            },
          };

        default:
          return {
            status: HttpStatus.INTERNAL_SERVER_ERROR,
            errorResponse: {
              success: false,
              error: {
                code: 'DATABASE_ERROR',
                message: 'A database error occurred',
              },
              timestamp: new Date().toISOString(),
            },
          };
      }
    }

    // Connection errors
    if (
      exception instanceof Prisma.PrismaClientInitializationError ||
      exception instanceof Prisma.PrismaClientRustPanicError
    ) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        errorResponse: {
          success: false,
          error: {
            code: 'DATABASE_UNAVAILABLE',
            message: 'Database temporarily unavailable',
          },
          timestamp: new Date().toISOString(),
        },
      };
    }

    // Query timeout
    if (exception.message?.includes('timeout')) {
      return {
        status: HttpStatus.GATEWAY_TIMEOUT,
        errorResponse: {
          success: false,
          error: {
            code: 'DATABASE_TIMEOUT',
            message: 'Request timed out. Please try again.',
          },
          timestamp: new Date().toISOString(),
        },
      };
    }

    // Generic database error
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      errorResponse: {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'A database error occurred',
        },
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Handle external service errors (SMS, Push services) (500, 502)
   * Requirements: 7.4
   */
  private handleExternalServiceError(exception: Error): {
    status: number;
    errorResponse: ErrorResponse;
  } {
    const message = exception.message.toLowerCase();

    // Service unavailable
    if (
      message.includes('unavailable') ||
      message.includes('connection refused') ||
      message.includes('econnrefused')
    ) {
      return {
        status: HttpStatus.BAD_GATEWAY,
        errorResponse: {
          success: false,
          error: {
            code: 'EXTERNAL_SERVICE_UNAVAILABLE',
            message: 'External service temporarily unavailable',
          },
          timestamp: new Date().toISOString(),
        },
      };
    }

    // Timeout
    if (message.includes('timeout') || message.includes('etimedout')) {
      return {
        status: HttpStatus.GATEWAY_TIMEOUT,
        errorResponse: {
          success: false,
          error: {
            code: 'EXTERNAL_SERVICE_TIMEOUT',
            message: 'External service request timed out',
          },
          timestamp: new Date().toISOString(),
        },
      };
    }

    // SMS service specific
    if (message.includes('sms')) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        errorResponse: {
          success: false,
          error: {
            code: 'SMS_SERVICE_ERROR',
            message: 'SMS service temporarily unavailable',
          },
          timestamp: new Date().toISOString(),
        },
      };
    }

    // Push service specific
    if (message.includes('push') || message.includes('fcm')) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        errorResponse: {
          success: false,
          error: {
            code: 'PUSH_SERVICE_ERROR',
            message: 'Push notification service temporarily unavailable',
          },
          timestamp: new Date().toISOString(),
        },
      };
    }

    // Generic external service error
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      errorResponse: {
        success: false,
        error: {
          code: 'EXTERNAL_SERVICE_ERROR',
          message: 'An external service error occurred',
        },
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Handle unknown errors
   */
  private handleUnknownError(exception: unknown): ErrorResponse {
    return {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        details:
          exception instanceof Error
            ? { message: exception.message }
            : undefined,
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Check if error is a Prisma error
   */
  private isPrismaError(exception: unknown): boolean {
    return (
      exception instanceof Prisma.PrismaClientKnownRequestError ||
      exception instanceof Prisma.PrismaClientUnknownRequestError ||
      exception instanceof Prisma.PrismaClientInitializationError ||
      exception instanceof Prisma.PrismaClientRustPanicError ||
      exception instanceof Prisma.PrismaClientValidationError
    );
  }

  /**
   * Check if error is from external service
   */
  private isExternalServiceError(exception: unknown): boolean {
    if (!(exception instanceof Error)) return false;

    const message = exception.message.toLowerCase();
    const errorPatterns = [
      'sms',
      'push',
      'fcm',
      'unavailable',
      'timeout',
      'econnrefused',
      'etimedout',
      'connection refused',
      'service error',
    ];

    return errorPatterns.some((pattern) => message.includes(pattern));
  }
}

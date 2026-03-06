import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { NotificationExceptionFilter } from './notification-exception.filter';
import {
  ValidationException,
  SMSServiceException,
  ExternalServiceUnavailableException,
} from '../exceptions/notification.exceptions';

describe('NotificationExceptionFilter', () => {
  let filter: NotificationExceptionFilter;
  let mockResponse: any;
  let mockRequest: any;
  let mockHost: any;

  beforeEach(async () => {
    filter = new NotificationExceptionFilter();

    // Mock response object
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    // Mock request object
    mockRequest = {
      method: 'POST',
      url: '/api/admin/notifications/send',
    };

    // Mock ArgumentsHost
    mockHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    };
  });

  describe('Rate Limiting Errors (429)', () => {
    it('should handle ThrottlerException with 429 status', () => {
      const exception = new ThrottlerException();

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.TOO_MANY_REQUESTS,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'RATE_LIMIT_EXCEEDED',
            message: expect.stringContaining('Rate limit exceeded'),
          }),
          timestamp: expect.any(String),
        }),
      );
    });
  });

  describe('Validation Errors (400)', () => {
    it('should handle ValidationException with 400 status', () => {
      const exception = new ValidationException('Invalid phone number');

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'VALIDATION_ERROR',
            message: expect.stringContaining('Invalid phone number'),
          }),
          timestamp: expect.any(String),
        }),
      );
    });

    it('should handle array of validation messages', () => {
      const exception = new HttpException(
        { message: ['Field 1 error', 'Field 2 error'] },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'VALIDATION_ERROR',
            message: 'Field 1 error, Field 2 error',
          }),
        }),
      );
    });
  });

  describe('Authentication Errors (401)', () => {
    it('should handle unauthorized exception with 401 status', () => {
      const exception = new HttpException(
        'Authentication required',
        HttpStatus.UNAUTHORIZED,
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'AUTHENTICATION_ERROR',
            message: 'Authentication required',
          }),
          timestamp: expect.any(String),
        }),
      );
    });

    it('should provide default message for unauthorized without message', () => {
      const exception = new HttpException('', HttpStatus.UNAUTHORIZED);

      filter.catch(exception, mockHost);

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: 'Authentication required',
          }),
        }),
      );
    });
  });

  describe('Database Errors (500, 504)', () => {
    it('should handle Prisma duplicate entry error with 409 status', () => {
      const exception = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        {
          code: 'P2002',
          clientVersion: '4.0.0',
          meta: { target: ['id'] },
        },
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'DUPLICATE_ENTRY',
            message: 'A record with this data already exists',
          }),
        }),
      );
    });

    it('should handle Prisma foreign key violation with 400 status', () => {
      const exception = new Prisma.PrismaClientKnownRequestError(
        'Foreign key constraint failed',
        {
          code: 'P2003',
          clientVersion: '4.0.0',
          meta: { field_name: 'adminId' },
        },
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'FOREIGN_KEY_VIOLATION',
            message: 'Invalid reference to related data',
          }),
        }),
      );
    });

    it('should handle Prisma record not found with 404 status', () => {
      const exception = new Prisma.PrismaClientKnownRequestError(
        'Record not found',
        {
          code: 'P2025',
          clientVersion: '4.0.0',
        },
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'RECORD_NOT_FOUND',
            message: 'The requested record was not found',
          }),
        }),
      );
    });

    it('should handle database connection error with 503 status', () => {
      const exception = new Prisma.PrismaClientInitializationError(
        'Cannot connect to database',
        '4.0.0',
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.SERVICE_UNAVAILABLE,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'DATABASE_UNAVAILABLE',
            message: 'Database temporarily unavailable',
          }),
        }),
      );
    });

    it('should handle database timeout with 504 status', () => {
      const exception = new Error('Query timeout exceeded');

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.GATEWAY_TIMEOUT,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'EXTERNAL_SERVICE_TIMEOUT',
            message: 'External service request timed out',
          }),
        }),
      );
    });
  });

  describe('External Service Errors (500, 502)', () => {
    it('should handle SMS service error with 500 status', () => {
      const exception = new SMSServiceException();

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'HTTP_ERROR',
            message: expect.stringContaining('SMS service'),
          }),
        }),
      );
    });

    it('should handle external service unavailable with 502 status', () => {
      const exception = new ExternalServiceUnavailableException('SMS');

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'HTTP_ERROR',
            message: expect.stringContaining('unavailable'),
          }),
        }),
      );
    });

    it('should detect SMS service error from error message', () => {
      const exception = new Error('SMS gateway connection refused');

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'EXTERNAL_SERVICE_UNAVAILABLE',
          }),
        }),
      );
    });

    it('should detect push service error from error message', () => {
      const exception = new Error('FCM service timeout');

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.GATEWAY_TIMEOUT,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'EXTERNAL_SERVICE_TIMEOUT',
          }),
        }),
      );
    });

    it('should handle connection refused error', () => {
      const exception = new Error('ECONNREFUSED: Connection refused');

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'EXTERNAL_SERVICE_UNAVAILABLE',
            message: 'External service temporarily unavailable',
          }),
        }),
      );
    });
  });

  describe('Error Response Format', () => {
    it('should return consistent error response format', () => {
      const exception = new HttpException('Test error', HttpStatus.BAD_REQUEST);

      filter.catch(exception, mockHost);

      const response = mockResponse.json.mock.calls[0][0];

      expect(response).toHaveProperty('success', false);
      expect(response).toHaveProperty('error');
      expect(response.error).toHaveProperty('code');
      expect(response.error).toHaveProperty('message');
      expect(response).toHaveProperty('timestamp');
      expect(new Date(response.timestamp)).toBeInstanceOf(Date);
    });

    it('should include details when available', () => {
      const exception = new ValidationException('Test error', {
        field: 'phoneNumber',
      });

      filter.catch(exception, mockHost);

      const response = mockResponse.json.mock.calls[0][0];

      expect(response.error).toHaveProperty('details');
      expect(response.error.details).toHaveProperty('details');
      expect(response.error.details.details).toHaveProperty(
        'field',
        'phoneNumber',
      );
    });
  });

  describe('Unknown Errors', () => {
    it('should handle unknown errors with 500 status', () => {
      const exception = new Error('Unknown error');

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred',
          }),
        }),
      );
    });

    it('should handle non-Error objects', () => {
      const exception = { weird: 'object' };

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'INTERNAL_ERROR',
          }),
        }),
      );
    });
  });
});

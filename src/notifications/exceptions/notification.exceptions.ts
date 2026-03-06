import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Custom exceptions for notification system
 * Requirements: 5.4, 7.4
 */

/**
 * Thrown when validation fails for notification parameters
 */
export class ValidationException extends HttpException {
  constructor(message: string, details?: any) {
    super(
      {
        statusCode: HttpStatus.BAD_REQUEST,
        message,
        details,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * Thrown when no recipients match the filter criteria
 */
export class NoRecipientsException extends ValidationException {
  constructor() {
    super('No recipients match the specified filters');
  }
}

/**
 * Thrown when phone number format is invalid
 */
export class InvalidPhoneNumberException extends ValidationException {
  constructor(phoneNumber: string) {
    super(`Invalid phone number format: ${phoneNumber}`);
  }
}

/**
 * Thrown when date range is invalid
 */
export class InvalidDateRangeException extends ValidationException {
  constructor() {
    super('End date must be after start date');
  }
}

/**
 * Thrown when balance values are invalid
 */
export class InvalidBalanceException extends ValidationException {
  constructor() {
    super('Balance values must be non-negative');
  }
}

/**
 * Thrown when message is empty
 */
export class EmptyMessageException extends ValidationException {
  constructor() {
    super('Message cannot be empty');
  }
}

/**
 * Thrown when message exceeds maximum length
 */
export class MessageTooLongException extends ValidationException {
  constructor(maxLength: number) {
    super(`SMS message exceeds maximum length of ${maxLength} characters`);
  }
}

/**
 * Thrown when CSV file is invalid
 */
export class InvalidCSVException extends ValidationException {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Thrown when CSV file is empty
 */
export class EmptyCSVException extends InvalidCSVException {
  constructor() {
    super('CSV file is empty');
  }
}

/**
 * Thrown when CSV file is not in CSV format
 */
export class InvalidCSVFormatException extends InvalidCSVException {
  constructor() {
    super('File must be in CSV format');
  }
}

/**
 * Thrown when CSV file has no valid phone numbers
 */
export class NoValidPhoneNumbersException extends InvalidCSVException {
  constructor() {
    super('No valid phone numbers found in CSV');
  }
}

/**
 * Thrown when CSV file exceeds maximum size
 */
export class CSVFileTooLargeException extends HttpException {
  constructor(maxSize: string = '5MB') {
    super(
      {
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        message: `CSV file exceeds maximum size of ${maxSize}`,
      },
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
  }
}

/**
 * Thrown when external SMS service fails
 */
export class SMSServiceException extends HttpException {
  constructor(message: string = 'SMS service temporarily unavailable') {
    super(
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message,
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

/**
 * Thrown when external Push service fails
 */
export class PushServiceException extends HttpException {
  constructor(
    message: string = 'Push notification service temporarily unavailable',
  ) {
    super(
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message,
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

/**
 * Thrown when external service is unavailable
 */
export class ExternalServiceUnavailableException extends HttpException {
  constructor(serviceName: string) {
    super(
      {
        statusCode: HttpStatus.BAD_GATEWAY,
        message: `${serviceName} service temporarily unavailable`,
      },
      HttpStatus.BAD_GATEWAY,
    );
  }
}

/**
 * Thrown when external service times out
 */
export class ExternalServiceTimeoutException extends HttpException {
  constructor(serviceName: string) {
    super(
      {
        statusCode: HttpStatus.GATEWAY_TIMEOUT,
        message: `${serviceName} service request timed out`,
      },
      HttpStatus.GATEWAY_TIMEOUT,
    );
  }
}

# Notification Error Handling

This directory contains the error handling middleware for the notification system.

## Overview

The notification system implements comprehensive error handling through a global exception filter that catches all errors and returns consistent error responses.

## Components

### NotificationExceptionFilter

A global exception filter that handles all error types with consistent response format.

**Location**: `notification-exception.filter.ts`

**Features**:

- Handles rate limiting errors (429)
- Handles validation errors (400)
- Handles authentication errors (401)
- Handles database errors (500, 504)
- Handles external service errors (500, 502)
- Returns consistent error response format
- Logs all errors with stack traces

### Custom Exceptions

**Location**: `../exceptions/notification.exceptions.ts`

Custom exception classes for specific error scenarios:

- `ValidationException` - Base validation error (400)
- `NoRecipientsException` - No recipients match filters (400)
- `InvalidPhoneNumberException` - Invalid phone number format (400)
- `InvalidDateRangeException` - Invalid date range (400)
- `InvalidBalanceException` - Invalid balance values (400)
- `EmptyMessageException` - Empty message (400)
- `MessageTooLongException` - Message exceeds max length (400)
- `InvalidCSVException` - Invalid CSV file (400)
- `EmptyCSVException` - Empty CSV file (400)
- `InvalidCSVFormatException` - Not a CSV file (400)
- `NoValidPhoneNumbersException` - No valid phone numbers in CSV (400)
- `CSVFileTooLargeException` - CSV file too large (413)
- `SMSServiceException` - SMS service error (500)
- `PushServiceException` - Push service error (500)
- `ExternalServiceUnavailableException` - External service unavailable (502)
- `ExternalServiceTimeoutException` - External service timeout (504)

## Error Response Format

All errors return a consistent JSON structure:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {} // Optional additional details
  },
  "timestamp": "2026-03-02T04:29:00.546Z"
}
```

## Error Types

### Validation Errors (400)

**Triggers**:

- Invalid filter parameters (negative balance, invalid date range)
- Malformed phone numbers
- Empty or too-long messages
- Invalid CSV files

**Response**:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Specific validation error message"
  },
  "timestamp": "2026-03-02T04:29:00.546Z"
}
```

### Authentication Errors (401)

**Triggers**:

- Missing authentication token
- Invalid authentication token
- Expired authentication token

**Response**:

```json
{
  "success": false,
  "error": {
    "code": "AUTHENTICATION_ERROR",
    "message": "Authentication required"
  },
  "timestamp": "2026-03-02T04:29:00.546Z"
}
```

### Rate Limiting Errors (429)

**Triggers**:

- Exceeding 10 bulk sends per hour

**Response**:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded. Maximum 10 bulk sends per hour. Try again later."
  },
  "timestamp": "2026-03-02T04:29:00.546Z"
}
```

### Database Errors (500, 504)

**Triggers**:

- Database connection errors
- Query timeouts
- Constraint violations
- Record not found

**Response Examples**:

Connection error (503):

```json
{
  "success": false,
  "error": {
    "code": "DATABASE_UNAVAILABLE",
    "message": "Database temporarily unavailable"
  },
  "timestamp": "2026-03-02T04:29:00.546Z"
}
```

Timeout (504):

```json
{
  "success": false,
  "error": {
    "code": "DATABASE_TIMEOUT",
    "message": "Request timed out. Please try again."
  },
  "timestamp": "2026-03-02T04:29:00.546Z"
}
```

### External Service Errors (500, 502)

**Triggers**:

- SMS service unavailable
- Push service unavailable
- Service timeouts
- Connection refused

**Response Examples**:

Service unavailable (502):

```json
{
  "success": false,
  "error": {
    "code": "EXTERNAL_SERVICE_UNAVAILABLE",
    "message": "External service temporarily unavailable"
  },
  "timestamp": "2026-03-02T04:29:00.546Z"
}
```

Service timeout (504):

```json
{
  "success": false,
  "error": {
    "code": "EXTERNAL_SERVICE_TIMEOUT",
    "message": "External service request timed out"
  },
  "timestamp": "2026-03-02T04:29:00.546Z"
}
```

## Usage

The exception filter is automatically applied to all notification endpoints through the NotificationsModule.

### Throwing Custom Exceptions

```typescript
import { InvalidPhoneNumberException } from './exceptions/notification.exceptions';

// In your service
if (!isValidPhoneNumber(phone)) {
  throw new InvalidPhoneNumberException(phone);
}
```

### Handling in Controllers

Controllers don't need to handle errors explicitly - the filter catches all exceptions:

```typescript
@Post('send')
async sendNotification(@Body() request: SendRequest) {
  // No try-catch needed - filter handles all errors
  return this.notificationsService.sendNotification(request);
}
```

## Testing

Comprehensive unit tests are provided in `notification-exception.filter.spec.ts`.

Run tests:

```bash
npm test -- src/notifications/filters/notification-exception.filter.spec.ts
```

## Requirements Validation

This implementation validates the following requirements:

- **Requirement 5.4**: Filter parameter validation with appropriate error responses
- **Requirement 7.2**: Authentication error handling (401)
- **Requirement 7.4**: Rate limiting error handling (429)
- **Error Handling Design**: Consistent error response format for all error types

## Logging

All errors are logged with:

- HTTP method and URL
- Status code
- Full stack trace (for debugging)

Example log:

```
[NotificationExceptionFilter] POST /api/admin/notifications/send - Status: 400
ValidationException: Invalid phone number format: +123
    at FilterService.validatePhoneNumber (filter.service.ts:45:11)
    ...
```

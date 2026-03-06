# SMS Service Integration

## Overview

The SMS Service provides a flexible, provider-agnostic interface for sending SMS messages. It supports multiple SMS providers with automatic fallback to a mock provider for development and testing.

## Supported Providers

### 1. Mock Provider (Default)

- **Use case**: Development, testing, CI/CD
- **Behavior**: Logs SMS sends without actually sending messages
- **Configuration**: No configuration needed (default)

### 2. Twilio

- **Use case**: Production SMS delivery
- **Requirements**: Twilio account and phone number
- **Package**: `npm install twilio`

### 3. AWS SNS

- **Use case**: Production SMS delivery (AWS infrastructure)
- **Requirements**: AWS account with SNS permissions
- **Package**: `npm install aws-sdk`

## Configuration

### Environment Variables

Add these variables to your `.env` file:

#### Mock Provider (Default)

```env
SMS_PROVIDER=mock
```

#### Twilio Provider

```env
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890
```

#### AWS SNS Provider

```env
SMS_PROVIDER=aws-sns
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
```

## Installation

### For Twilio

```bash
npm install twilio
```

### For AWS SNS

```bash
npm install aws-sdk
```

## Usage

The SMS service is automatically injected into the NotificationsService. You can also inject it directly into other services:

```typescript
import { Injectable } from '@nestjs/common';
import { SMSService } from './notifications/sms.service';

@Injectable()
export class MyService {
  constructor(private smsService: SMSService) {}

  async sendWelcomeSMS(phoneNumber: string) {
    const result = await this.smsService.sendSMS(
      phoneNumber,
      'Welcome to MenoDAO!',
    );

    if (result.success) {
      console.log(`SMS sent successfully: ${result.messageId}`);
    } else {
      console.error(`SMS failed: ${result.error}`);
    }
  }
}
```

## API Reference

### `sendSMS(phone: string, message: string): Promise<DeliveryResult>`

Sends an SMS message to the specified phone number.

**Parameters:**

- `phone` (string): Phone number in E.164 format (e.g., `+1234567890`)
- `message` (string): Message content to send

**Returns:** `Promise<DeliveryResult>`

```typescript
interface DeliveryResult {
  success: boolean; // Whether the SMS was sent successfully
  messageId?: string; // Provider's message ID (on success)
  error?: string; // Error message (on failure)
  timestamp: Date; // When the send was attempted
}
```

**Example:**

```typescript
const result = await smsService.sendSMS('+1234567890', 'Hello World!');

if (result.success) {
  console.log(`Sent at ${result.timestamp}, ID: ${result.messageId}`);
} else {
  console.error(`Failed: ${result.error}`);
}
```

### `getProviderName(): string`

Returns the name of the currently active SMS provider.

**Returns:** `string` - Provider class name (e.g., "MockSMSProvider", "TwilioSMSProvider")

**Example:**

```typescript
const provider = smsService.getProviderName();
console.log(`Using provider: ${provider}`);
```

## Features

### Automatic Retry Logic

The service implements exponential backoff retry logic for transient failures:

- **Max retries**: 3 attempts
- **Backoff delays**: 2s, 4s, 8s
- **Permanent errors**: No retry (e.g., invalid phone number)

### Error Handling

The service handles various error scenarios:

- **Network failures**: Automatic retry with exponential backoff
- **Invalid phone numbers**: Immediate failure (no retry)
- **Provider unavailable**: Falls back to mock provider
- **Missing credentials**: Falls back to mock provider

### Delivery Tracking

Each SMS send returns a `DeliveryResult` with:

- Success/failure status
- Provider message ID (for tracking)
- Error details (if failed)
- Timestamp of the attempt

## Phone Number Format

Phone numbers should be in **E.164 format**:

- Start with `+` followed by country code
- No spaces, dashes, or parentheses
- Examples:
  - US: `+1234567890`
  - UK: `+44123456789`
  - Japan: `+81234567890`

The mock provider accepts any format for testing, but production providers (Twilio, AWS SNS) require E.164 format.

## Testing

### Unit Tests

Run the SMS service tests:

```bash
npm test -- sms.service.spec.ts
```

### Integration Testing

For integration tests, use the mock provider:

```typescript
// In your test file
process.env.SMS_PROVIDER = 'mock';

// Your tests here
const result = await smsService.sendSMS('+1234567890', 'Test message');
expect(result.success).toBe(true);
```

### Testing with Real Providers

To test with real providers in a staging environment:

1. Set up a test phone number
2. Configure provider credentials
3. Send test messages
4. Verify delivery

```typescript
// Example test
const result = await smsService.sendSMS(
  '+1234567890', // Your test phone number
  'This is a test message from MenoDAO',
);

expect(result.success).toBe(true);
expect(result.messageId).toBeDefined();
```

## Monitoring and Logging

The SMS service logs all operations:

- **Info logs**: Successful sends, provider initialization
- **Warning logs**: Retry attempts, fallback to mock provider
- **Error logs**: Failed sends, configuration issues

Example logs:

```
[SMSService] Using Mock SMS provider (no actual SMS will be sent)
[MockSMSProvider] [MOCK SMS] To: +1234567890, Message: Hello World!
[SMSService] SMS delivered successfully to +1234567890
```

## Cost Considerations

### Twilio

- Pay per message sent
- Costs vary by destination country
- Failed messages may still incur charges

### AWS SNS

- Pay per message sent
- Costs vary by destination country
- Free tier: 100 SMS/month (US only)

### Mock Provider

- No cost (no actual messages sent)
- Use for development and testing

## Security Best Practices

1. **Never commit credentials**: Use environment variables
2. **Rotate credentials regularly**: Update API keys periodically
3. **Use IAM roles**: For AWS SNS, prefer IAM roles over access keys
4. **Rate limiting**: Implement rate limiting to prevent abuse
5. **Validate phone numbers**: Always validate before sending
6. **Monitor usage**: Track SMS volume and costs

## Troubleshooting

### Provider falls back to mock

**Symptom**: Logs show "Using Mock SMS provider" when you expect a real provider

**Solutions**:

1. Check environment variables are set correctly
2. Verify credentials are valid
3. Ensure required npm packages are installed
4. Check for typos in `SMS_PROVIDER` value

### SMS not delivered

**Symptom**: `result.success` is `false`

**Solutions**:

1. Verify phone number is in E.164 format
2. Check provider account has sufficient balance
3. Verify phone number is not blocked/invalid
4. Check provider dashboard for delivery status
5. Review error message in `result.error`

### Twilio package not found

**Symptom**: Error "Cannot find module 'twilio'"

**Solution**:

```bash
npm install twilio
```

### AWS SDK not found

**Symptom**: Error "Cannot find module 'aws-sdk'"

**Solution**:

```bash
npm install aws-sdk
```

## Migration Guide

### From placeholder to SMS service

If you're migrating from the old placeholder `sendSMS` method:

**Before:**

```typescript
await this.sendSMS(phoneNumber, message);
```

**After:**

```typescript
const result = await this.smsService.sendSMS(phoneNumber, message);
if (!result.success) {
  // Handle failure
  this.logger.error(`SMS failed: ${result.error}`);
}
```

## Future Enhancements

Potential improvements for the SMS service:

1. **Additional providers**: Support for more SMS gateways
2. **Message templates**: Pre-defined message templates
3. **Delivery webhooks**: Real-time delivery status updates
4. **Batch sending**: Optimize for bulk SMS sends
5. **Message scheduling**: Schedule SMS for future delivery
6. **Analytics**: Track delivery rates and costs

## Support

For issues or questions:

1. Check the logs for error messages
2. Verify configuration and credentials
3. Review provider documentation (Twilio/AWS SNS)
4. Contact the development team

## References

- [Twilio SMS API Documentation](https://www.twilio.com/docs/sms)
- [AWS SNS SMS Documentation](https://docs.aws.amazon.com/sns/latest/dg/sms_publish-to-phone.html)
- [E.164 Phone Number Format](https://en.wikipedia.org/wiki/E.164)

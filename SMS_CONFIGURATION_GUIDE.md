# SMS Configuration Guide

## Current Status

Your SMS notifications are **not being sent** because the system is using the **Mock SMS Provider**. This provider only logs messages to the console without actually sending them.

## Quick Fix

To enable real SMS delivery, you need to configure one of the supported SMS providers in your `.env` file.

## Supported Providers

### Option 1: AWS SNS (Recommended for AWS deployments)

AWS SNS is recommended if you're already using AWS infrastructure.

**Steps:**

1. Install the AWS SDK:

   ```bash
   npm install aws-sdk
   ```

2. Add these variables to your `.env` file:

   ```bash
   SMS_PROVIDER=aws-sns
   AWS_REGION=us-east-1
   AWS_ACCESS_KEY_ID=your_access_key_here
   AWS_SECRET_ACCESS_KEY=your_secret_key_here
   ```

3. Ensure your AWS IAM user has SNS permissions:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["sns:Publish"],
         "Resource": "*"
       }
     ]
   }
   ```

4. Restart your backend server

**Pricing:** AWS SNS charges approximately $0.00645 per SMS for Kenya

### Option 2: Twilio

Twilio is a popular SMS service with good international coverage.

**Steps:**

1. Sign up at https://www.twilio.com/
2. Get your credentials from https://console.twilio.com/
3. Purchase a phone number from Twilio

4. Install Twilio SDK:

   ```bash
   npm install twilio
   ```

5. Add these variables to your `.env` file:

   ```bash
   SMS_PROVIDER=twilio
   TWILIO_ACCOUNT_SID=your_account_sid_here
   TWILIO_AUTH_TOKEN=your_auth_token_here
   TWILIO_PHONE_NUMBER=+1234567890
   ```

6. Restart your backend server

**Pricing:** Twilio charges approximately $0.05 per SMS for Kenya

## Verification

After configuration, run this command to verify:

```bash
npm run ts-node scripts/check-sms-config.ts
```

## Testing

To test SMS delivery without making a real payment:

1. Check the logs after a payment is completed
2. Look for these log messages:
   - `[SMS] Welcome notification sent to +254...` (for new subscriptions)
   - `[SMS] Upgrade notification sent to +254...` (for upgrades)
   - `[SMS] Failed to send...` (if there's an error)

## Troubleshooting

### SMS not being sent

1. **Check provider configuration:**

   ```bash
   npm run ts-node scripts/check-sms-config.ts
   ```

2. **Check logs for SMS attempts:**

   ```bash
   # For dev environment
   ./infrastructure/scripts/get-logs.sh dev | grep SMS
   ```

3. **Verify phone number format:**
   - Phone numbers must be in E.164 format: `+254712345678`
   - Check the database to ensure member phone numbers are correctly formatted

### Mock provider still being used

If you've configured credentials but the mock provider is still being used:

1. Check that environment variables are loaded:

   ```bash
   echo $SMS_PROVIDER
   ```

2. Restart the backend server completely

3. Check logs for provider initialization:
   ```
   [SMSService] Using Mock SMS provider
   [SMSService] Twilio SMS provider initialized
   [SMSService] AWS SNS SMS provider initialized
   ```

### AWS SNS specific issues

- **InvalidParameter error:** Phone number format is incorrect
- **AccessDenied error:** IAM user doesn't have SNS:Publish permission
- **Throttling error:** You're sending too many messages too quickly

### Twilio specific issues

- **21211 error:** Invalid phone number
- **21614 error:** Invalid phone number format
- **21408 error:** Permission denied (check account status)

## Production Deployment

For production deployment on AWS:

1. Use AWS SNS provider (already integrated with your AWS infrastructure)
2. Store credentials in AWS Secrets Manager or Parameter Store
3. Use IAM roles instead of access keys when possible
4. Set up CloudWatch alarms for SMS delivery failures
5. Monitor SMS costs in AWS Cost Explorer

## Environment-Specific Configuration

### Development

```bash
SMS_PROVIDER=mock  # No actual SMS sent
```

### Staging/Dev

```bash
SMS_PROVIDER=aws-sns  # Use real SMS for testing
AWS_REGION=us-east-1
# Use staging AWS credentials
```

### Production

```bash
SMS_PROVIDER=aws-sns
AWS_REGION=us-east-1
# Use production AWS credentials with proper IAM roles
```

## Cost Optimization

1. **Use transactional SMS type** (already configured)
2. **Monitor delivery rates** to avoid sending to invalid numbers
3. **Implement rate limiting** to prevent abuse
4. **Use SMS templates** to reduce message length
5. **Consider batching** for non-urgent notifications

## Support

If you continue to have issues:

1. Check the application logs for detailed error messages
2. Verify your SMS provider account status and balance
3. Test with a single phone number first
4. Contact your SMS provider's support if delivery fails consistently

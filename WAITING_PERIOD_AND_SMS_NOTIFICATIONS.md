# Waiting Period Status & SMS Notifications

## Overview

This document describes the implementation of the waiting period status endpoint and SMS notifications for subscription activations and upgrades.

## Features Implemented

### 1. Waiting Period Status Endpoint

**Endpoint**: `GET /subscriptions/waiting-period-status`

**Authentication**: Required (JWT)

**Response**:

```json
{
  "consultationsExtractions": {
    "available": false,
    "daysRemaining": 45,
    "requiredDays": 60,
    "eligibleDate": "2026-04-19T10:30:00.000Z"
  },
  "restorativeProcedures": {
    "available": false,
    "daysRemaining": 75,
    "requiredDays": 90,
    "eligibleDate": "2026-05-19T10:30:00.000Z"
  },
  "paymentFrequency": "MONTHLY",
  "subscriptionStartDate": "2026-03-05T10:30:00.000Z"
}
```

**Features**:

- Shows days remaining until procedures become available
- Provides projected eligibility date for each procedure category
- Differentiates between emergency (consultations/extractions) and restorative procedures
- Respects payment frequency (MONTHLY vs ANNUAL) for waiting period calculation

**Waiting Period Rules**:

- **Annual Subscribers**: 14 days for all procedures
- **Monthly Subscribers**:
  - Emergency procedures (consultations, extractions): 60 days
  - Restorative procedures (fillings, root canals, etc.): 90 days

### 2. SMS Notifications

#### New Subscription Activation

**Trigger**: When a new subscription payment is confirmed

**Message Format**:

```
Welcome to MenoDAO! Your MenoBronze subscription is now active. You can start making claims on April 19, 2026 (60 days waiting period). Visit your dashboard to explore your benefits. Thank you for joining us!
```

**Features**:

- Personalized with tier name (MenoBronze, MenoSilver, MenoGold)
- Includes specific eligibility date
- Shows waiting period duration
- Sent automatically after payment callback

#### Subscription Upgrade

**Trigger**: When an upgrade payment is confirmed

**Message Format**:

```
Congratulations! Your MenoDAO subscription has been upgraded to MenoGold. Your new benefits are now active. You can start making claims on March 19, 2026 (14 days waiting period). Thank you for choosing MenoDAO!
```

**Features**:

- Confirms upgrade to new tier
- Includes new eligibility date
- Shows waiting period for upgraded subscription
- Sent automatically after upgrade payment callback

## Implementation Details

### Backend Changes

**Files Modified**:

1. `src/subscriptions/subscriptions.controller.ts`
   - Added `getWaitingPeriodStatus()` endpoint

2. `src/subscriptions/subscriptions.service.ts`
   - Enhanced `getWaitingPeriodStatus()` method to include eligibility dates
   - Added payment frequency and subscription start date to response

3. `src/payments/payment.service.ts`
   - Added SMS service injection
   - Added SMS notification logic in payment callback
   - Sends welcome SMS for new subscriptions
   - Sends upgrade confirmation SMS for upgrades
   - Non-blocking SMS sending (failures don't affect payment processing)

4. `src/payments/payment.module.ts`
   - Imported NotificationsModule to enable SMS service

### Frontend Changes

**Files Modified**:

1. `src/lib/api.ts`
   - Updated `getWaitingPeriodStatus()` return type to include eligibility dates

2. `src/app/dashboard/components/WaitingPeriodDisplay.tsx`
   - Connected to real API endpoint (removed mock data)
   - Display eligibility dates below progress bars
   - Format dates in Kenyan locale

## Testing

### Backend Tests

```bash
npm run test -- --testNamePattern="subscriptions"
```

All tests passing ✅

### Manual Testing

1. **New Subscription**:
   - Sign up and complete payment
   - Check SMS received with welcome message
   - Verify eligibility date is correct
   - Check `/subscriptions/waiting-period-status` endpoint

2. **Upgrade**:
   - Upgrade from Bronze to Gold
   - Complete payment
   - Check SMS received with upgrade confirmation
   - Verify new eligibility date
   - Check endpoint shows updated waiting period

3. **Waiting Period Display**:
   - Navigate to Claims tab
   - Verify waiting period status shows:
     - Days remaining
     - Eligibility date
     - Progress bars
     - Correct waiting period based on payment frequency

## SMS Provider Configuration

The system uses the existing SMS service which supports:

- **Mock Provider** (development): Logs SMS without sending
- **Twilio** (production): Requires configuration
- **AWS SNS** (production): Requires configuration

**Environment Variables**:

```env
# For Twilio
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=your_twilio_number

# For AWS SNS
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
```

## Error Handling

- SMS failures are logged but don't block payment processing
- If SMS service is unavailable, payment still completes successfully
- Errors are logged with `[SMS]` prefix for easy debugging
- Users can still see waiting period status in dashboard even if SMS fails

## Deployment

Both backend and frontend changes have been pushed to the `dev` branch and will be automatically deployed via GitHub Actions.

**Backend**: Deployed to ECS dev environment
**Frontend**: Deployed to Amplify dev environment

## Future Enhancements

1. **SMS Retry Logic**: Implement retry mechanism for failed SMS
2. **SMS Templates**: Move SMS messages to database for easy editing
3. **Multi-language Support**: Support SMS in multiple languages
4. **SMS History**: Track all SMS sent to members
5. **Email Notifications**: Add email notifications alongside SMS
6. **Push Notifications**: Add mobile push notifications

## Monitoring

**Logs to Monitor**:

```bash
# Watch for SMS notifications
aws logs tail /ecs/menodao-api --since 5m --region us-east-1 --filter-pattern "[SMS]"

# Watch for payment callbacks
aws logs tail /ecs/menodao-api --since 5m --region us-east-1 --filter-pattern "Payment completed"

# Watch for upgrades
aws logs tail /ecs/menodao-api --since 5m --region us-east-1 --filter-pattern "[UPGRADE]"
```

## Support

If SMS notifications are not being received:

1. Check CloudWatch logs for SMS errors
2. Verify SMS provider configuration
3. Check member's phone number format
4. Verify SMS service is initialized correctly
5. Check SMS provider balance/credits

For waiting period issues:

1. Verify subscription start date is set correctly
2. Check payment frequency (MONTHLY vs ANNUAL)
3. Verify subscription is active
4. Check endpoint response in browser DevTools

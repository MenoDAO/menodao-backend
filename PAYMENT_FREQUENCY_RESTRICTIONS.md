# Payment Frequency Restrictions Implementation

## Overview

This document describes the implementation of payment frequency restrictions to prevent duplicate payments within the same billing period.

## Changes Made

### 1. Added `paymentFrequency` Field to SubscribeDto

**File**: `src/subscriptions/dto/subscribe.dto.ts`

Added optional `paymentFrequency` field that defaults to `MONTHLY`:

```typescript
@ApiProperty({
  enum: PaymentFrequency,
  example: 'MONTHLY',
  required: false,
  description: 'Payment frequency (defaults to MONTHLY)',
})
@IsEnum(PaymentFrequency)
@IsOptional()
paymentFrequency?: PaymentFrequency;
```

### 2. Updated Controller to Pass Payment Frequency

**File**: `src/subscriptions/subscriptions.controller.ts`

Modified the subscribe endpoint to pass payment frequency to the service:

```typescript
async subscribe(@Request() req: RequestWithUser, @Body() dto: SubscribeDto) {
  return this.subscriptionsService.subscribe(
    req.user.id,
    dto.tier,
    dto.paymentFrequency || 'MONTHLY',
  );
}
```

### 3. Implemented Payment Frequency Restriction Logic

**File**: `src/subscriptions/subscriptions.service.ts`

Added `checkPaymentFrequencyRestriction()` method that:

- Checks the last completed payment for the member
- For MONTHLY frequency: Prevents payment twice in the same month
- For ANNUAL frequency: Prevents payment twice in the same year
- Bypasses restrictions in development environment for testing
- Provides clear error messages with next allowed payment date

### 4. Updated Subscribe Logic

**File**: `src/subscriptions/subscriptions.service.ts`

Modified the `subscribe()` method to:

1. Check if member has active subscription to same tier → reject immediately
2. Check if member has active subscription to different tier → check frequency restriction
3. If frequency check passes → allow subscription update/creation

### 5. Fixed Test Suite

**File**: `src/subscriptions/subscriptions.service.spec.ts`

Updated test to correctly verify same-tier subscription rejection:

- Changed test to use same tier (BRONZE → BRONZE) instead of different tier
- Added explicit error message verification
- Added mock for contribution.findFirst to support frequency check

## Business Rules

### Monthly Subscribers

- Cannot make payment twice in the same calendar month
- Error message shows first day of next month as next allowed payment date
- Example: Payment on March 5 → Next allowed: April 1

### Annual Subscribers

- Cannot make payment twice within 365 days
- Error message shows exact date one year from last payment
- Example: Payment on March 5, 2025 → Next allowed: March 5, 2026

### Upgrades

- Upgrades are EXEMPT from frequency restrictions
- Users can upgrade at any time regardless of last payment date
- Upgrade cost respects original payment frequency (monthly vs annual)

### Development Environment

- All frequency restrictions are bypassed in dev mode
- Allows unlimited testing without waiting periods
- Logged with `[DEV]` prefix for visibility

## Error Messages

### Monthly Restriction

```
You have already made a payment this month. Next payment allowed on [Date].
If you want to upgrade to a higher tier, please use the upgrade option instead.
```

### Annual Restriction

```
You have already made an annual payment. Next payment allowed on [Date] ([X] days remaining).
If you want to upgrade to a higher tier, please use the upgrade option instead.
```

### Same Tier Subscription

```
You already have an active subscription to this tier. If you want to upgrade,
please select a higher tier.
```

## Testing

All tests pass successfully:

- ✅ Same tier subscription rejection
- ✅ Inactive subscription update
- ✅ New subscription creation
- ✅ Upgrade validation
- ✅ Full test suite (187 tests passed)

## Next Steps

1. ✅ Test manually with both monthly and annual subscriptions
2. ✅ Verify error messages display correctly in frontend
3. ✅ Deploy to dev environment
4. Test in production with real payment scenarios

## Related Files

- `src/subscriptions/dto/subscribe.dto.ts`
- `src/subscriptions/subscriptions.controller.ts`
- `src/subscriptions/subscriptions.service.ts`
- `src/subscriptions/subscriptions.service.spec.ts`
- `UPGRADE_FIXES.md` (previous upgrade fixes)
- `WAITING_PERIOD_AND_SMS_NOTIFICATIONS.md` (SMS notifications)

## Update: Fixed Upgrade Cost Display for Annual Plans

### Issue

Upgrade cost was showing monthly difference even for annual subscribers.

### Root Cause

Frontend was only using `displayAmount` from the upgrade API response. The backend returns both:

- `paymentAmount`: Actual charge amount (respects dev/prod pricing and payment frequency)
- `displayAmount`: Display amount (always production prices for consistency)

### Fix Applied

**Files Modified**:

- `🖥️ menodao-frontend/src/app/(dashboard)/dashboard/subscription/PaymentDialog.tsx`

**Changes**:

1. Updated `upgradeInfo` state to include both `paymentAmount` and `displayAmount`
2. Use `paymentAmount` for actual payment (respects annual vs monthly)
3. Display `displayAmount` to users (production prices)
4. Show dev pricing note when amounts differ (dev environment only)

### Backend Logic (Already Correct)

```typescript
// Calculate actual charge (respects frequency)
const currentPrice = this.getPrice(
  existing.tier,
  existing.paymentFrequency === 'ANNUAL' ? 'annual' : 'monthly',
);
const newPrice = this.getPrice(
  newTier,
  existing.paymentFrequency === 'ANNUAL' ? 'annual' : 'monthly',
);
const upgradeCost = newPrice - currentPrice;

// Calculate display amount (always production prices)
const currentDisplayPrice = this.getDisplayPrice(
  existing.tier,
  existing.paymentFrequency === 'ANNUAL' ? 'annual' : 'monthly',
);
const newDisplayPrice = this.getDisplayPrice(
  newTier,
  existing.paymentFrequency === 'ANNUAL' ? 'annual' : 'monthly',
);
const displayUpgradeCost = newDisplayPrice - currentDisplayPrice;

return {
  paymentAmount: upgradeCost, // Used for actual payment
  displayAmount: displayUpgradeCost, // Shown to user
  message: `Pay the difference of KES ${displayUpgradeCost}...`,
};
```

### Verification Example

**Scenario**: User has BRONZE annual subscription (KES 4,200)

- Upgrade to SILVER
- Expected upgrade cost: KES 2,400 (6,600 - 4,200 annual difference)
- Previously showed: KES 200 (550 - 350 monthly difference) ❌
- Now shows: KES 2,400 ✅

### Updated Business Rules

- **Annual subscribers pay annual price difference**
- **Monthly subscribers pay monthly price difference**
- Upgrade cost calculation respects original payment frequency
- Display amount always shows production prices for consistency
- Dev environment shows both production and dev pricing

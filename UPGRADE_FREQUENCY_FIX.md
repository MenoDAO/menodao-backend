# Upgrade Cost Frequency Fix

## Problem

Upgrade costs were showing monthly difference even for annual subscribers.

## Root Cause

The `paymentFrequency` field was not being passed from frontend to backend when creating subscriptions. The flow was:

1. User selects tier
2. Subscription created immediately (without frequency)
3. User selects frequency in payment dialog
4. Payment initiated (but subscription already created with default MONTHLY)

This meant ALL subscriptions had `paymentFrequency: MONTHLY` regardless of what the user selected.

## Solution

### Backend (Already Correct)

The backend `upgrade()` method correctly calculates upgrade cost based on `subscription.paymentFrequency`:

```typescript
const currentPrice = this.getPrice(
  existing.tier,
  existing.paymentFrequency === 'ANNUAL' ? 'annual' : 'monthly',
);
const newPrice = this.getPrice(
  newTier,
  existing.paymentFrequency === 'ANNUAL' ? 'annual' : 'monthly',
);
```

### Frontend Fixes

#### 1. Updated API Function

**File**: `🖥️ menodao-frontend/src/lib/api.ts`

Added `paymentFrequency` parameter to `subscribe()`:

```typescript
async subscribe(
  tier: "BRONZE" | "SILVER" | "GOLD",
  paymentFrequency?: "MONTHLY" | "ANNUAL",
) {
  return this.request<Subscription>("/subscriptions/subscribe", {
    method: "POST",
    body: JSON.stringify({ tier, paymentFrequency }),
  });
}
```

#### 2. Changed Subscription Flow

**File**: `🖥️ menodao-frontend/src/app/(dashboard)/dashboard/subscription/page.tsx`

Changed flow to:

1. User selects tier → Opens PaymentDialog (NO subscription created yet)
2. User selects frequency in PaymentDialog
3. PaymentDialog creates subscription WITH selected frequency
4. User proceeds to payment

Updated `subscribeMutation` to accept frequency:

```typescript
const subscribeMutation = useMutation({
  mutationFn: ({
    tier,
    paymentFrequency,
  }: {
    tier: 'BRONZE' | 'SILVER' | 'GOLD';
    paymentFrequency?: 'MONTHLY' | 'ANNUAL';
  }) => api.subscribe(tier, paymentFrequency),
  // ...
});
```

Updated `handleSubscribe` to just open dialog:

```typescript
const handleSubscribe = async (tier: 'BRONZE' | 'SILVER' | 'GOLD') => {
  // Just open the payment dialog - subscription will be created after frequency selection
  setSelectedTier(tier);
  setIsPaymentDialogOpen(true);
};
```

#### 3. Updated PaymentDialog

**File**: `🖥️ menodao-frontend/src/app/(dashboard)/dashboard/subscription/PaymentDialog.tsx`

Added `onSubscribe` prop to create subscription after frequency selection:

```typescript
interface PaymentDialogProps {
  // ... other props
  onSubscribe?: (
    tier: 'BRONZE' | 'SILVER' | 'GOLD',
    frequency: 'MONTHLY' | 'ANNUAL',
  ) => Promise<void>;
}
```

Updated `handleContinueToPayment` to create subscription:

```typescript
const handleContinueToPayment = async () => {
  if (!selectedFrequency) return;

  // For new subscriptions, create with selected frequency
  if (!isUpgrade && onSubscribe) {
    try {
      await onSubscribe(tier, selectedFrequency);
    } catch (error) {
      setErrorMessage((error as Error).message);
      setPaymentStatus('FAILED');
      return;
    }
  }

  setPaymentStatus('IDLE');
};
```

## Verification

### Before Fix

1. User subscribes to BRONZE with annual payment (selects annual in dialog)
2. Subscription created with `paymentFrequency: MONTHLY` (default)
3. User upgrades to SILVER
4. Upgrade cost calculated as: 550 - 350 = KES 200 (monthly difference) ❌

### After Fix

1. User subscribes to BRONZE with annual payment (selects annual in dialog)
2. Subscription created with `paymentFrequency: ANNUAL` ✅
3. User upgrades to SILVER
4. Upgrade cost calculated as: 6,600 - 4,200 = KES 2,400 (annual difference) ✅

## Testing Steps

1. Create new subscription with annual payment
2. Verify subscription has `paymentFrequency: ANNUAL` in database
3. Upgrade to higher tier
4. Verify upgrade cost shows annual difference (e.g., 2,400 not 200)

## Migration Note

Existing subscriptions in the database have `paymentFrequency: MONTHLY` by default. If users actually paid annually, their records need to be updated manually or through a migration script.

## Related Files

- `🖥️ menodao-frontend/src/lib/api.ts`
- `🖥️ menodao-frontend/src/app/(dashboard)/dashboard/subscription/page.tsx`
- `🖥️ menodao-frontend/src/app/(dashboard)/dashboard/subscription/PaymentDialog.tsx`
- `⚙️ menodao-backend/src/subscriptions/subscriptions.service.ts` (already correct)
- `⚙️ menodao-backend/src/subscriptions/dto/subscribe.dto.ts` (already has field)
- `PAYMENT_FREQUENCY_RESTRICTIONS.md` (related documentation)

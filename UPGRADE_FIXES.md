# Upgrade System Fixes

## Issues Fixed

### 1. Incorrect Upgrade Endpoint Call for First-Time Subscriptions

**Problem**:
After a user successfully paid for their first subscription, the system would incorrectly try to call the upgrade endpoint when they tried to view or interact with subscription options again. This caused a 400 error because the system thought they were upgrading when they weren't.

**Root Cause**:
The frontend logic was checking `if (subscription?.isActive)` to determine if it should call the upgrade endpoint. However, after the first payment, the subscription becomes active, so any subsequent interaction was treated as an upgrade attempt.

**Fix**:
Updated the frontend logic to properly check if this is truly an upgrade:

```typescript
const isUpgrade =
  subscription?.isActive && tierOrder[tier] > tierOrder[subscription.tier];
```

Now the system only calls the upgrade endpoint when:

1. User has an active subscription AND
2. User is selecting a higher tier than their current tier

**Files Changed**:

- `🖥️ menodao-frontend/src/app/(dashboard)/dashboard/subscription/page.tsx`

### 2. Upgrade Cost Calculation Respects Payment Frequency

**Problem**:
User reported that upgrade costs should be relative to the payment plan. If an annual payment plan was used for the original package, the upgrade cost should be the annual difference, not the monthly difference.

**Status**:
✅ Already working correctly! The backend logic was already implemented correctly.

**Verification**:
Created a test script that verifies all upgrade cost calculations:

```
Test: Monthly Bronze to Silver
  Expected: 200 KES (550 - 350)
  Calculated: 200 KES ✅

Test: Annual Bronze to Silver
  Expected: 2400 KES (6600 - 4200)
  Calculated: 2400 KES ✅

Test: Annual Bronze to Gold
  Expected: 4200 KES (8400 - 4200)
  Calculated: 4200 KES ✅
```

All 5 test cases passed.

**Backend Logic**:

```typescript
const currentPrice = this.getPrice(
  existing.tier,
  existing.paymentFrequency === 'ANNUAL' ? 'annual' : 'monthly',
);
const newPrice = this.getPrice(
  newTier,
  existing.paymentFrequency === 'ANNUAL' ? 'annual' : 'monthly',
);
const upgradeCost = newPrice - currentPrice;
```

The system correctly:

1. Checks the user's current payment frequency
2. Uses annual prices if they're on an annual plan
3. Uses monthly prices if they're on a monthly plan
4. Calculates the difference based on the correct frequency

**Files Verified**:

- `⚙️ menodao-backend/src/subscriptions/subscriptions.service.ts`
- `⚙️ menodao-backend/scripts/test-upgrade-cost-calculation.ts` (new test script)

## Upgrade Cost Examples

### Monthly Plan Upgrades

- Bronze (350) → Silver (550) = **200 KES**
- Bronze (350) → Gold (700) = **350 KES**
- Silver (550) → Gold (700) = **150 KES**

### Annual Plan Upgrades

- Bronze (4200) → Silver (6600) = **2400 KES**
- Bronze (4200) → Gold (8400) = **4200 KES**
- Silver (6600) → Gold (8400) = **1800 KES**

## Testing

### Manual Testing Steps

1. **First-Time Subscription**:
   - Sign up as new user
   - Select Bronze package
   - Complete payment
   - ✅ Should NOT see 400 error
   - ✅ Subscription should activate
   - ✅ Should receive welcome SMS

2. **Upgrade from Monthly Plan**:
   - Have active Bronze monthly subscription
   - Click upgrade to Silver
   - ✅ Should show upgrade cost: 200 KES
   - Complete payment
   - ✅ Should receive upgrade SMS
   - ✅ Tier should update to Silver

3. **Upgrade from Annual Plan**:
   - Have active Bronze annual subscription
   - Click upgrade to Silver
   - ✅ Should show upgrade cost: 2400 KES (not 200)
   - Complete payment
   - ✅ Should receive upgrade SMS
   - ✅ Tier should update to Silver

4. **Upgrade with Active Claims**:
   - Have active subscription with approved claims
   - Try to upgrade
   - ✅ Should show error: "You have active claims..."
   - ✅ Should NOT allow upgrade

### Automated Testing

Run the upgrade cost calculation test:

```bash
npx ts-node scripts/test-upgrade-cost-calculation.ts
```

Expected output:

```
=== Testing Upgrade Cost Calculation ===
...
✅ All tests passed!
```

## Deployment

Both fixes have been pushed to the `dev` branch:

- Frontend: Commit d103ab7
- Backend: Commit 8a96dbb

Deployment will happen automatically via GitHub Actions.

## Related Documentation

- [WAITING_PERIOD_AND_SMS_NOTIFICATIONS.md](./WAITING_PERIOD_AND_SMS_NOTIFICATIONS.md) - SMS notifications for subscriptions
- [UPGRADE_DEBUG_GUIDE.md](./UPGRADE_DEBUG_GUIDE.md) - Debugging upgrade issues
- [URGENT_UPGRADE_FIX.md](./URGENT_UPGRADE_FIX.md) - Previous upgrade metadata fix

## Future Improvements

1. **Better Error Messages**: Show user-friendly error messages instead of generic 400 errors
2. **Upgrade Preview**: Show users a preview of what they'll get before upgrading
3. **Prorated Refunds**: Consider prorating refunds for downgrades (if we add that feature)
4. **Upgrade History**: Track all upgrades in a separate table for analytics

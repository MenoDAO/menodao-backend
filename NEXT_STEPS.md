# Next Steps to Fix Upgrade Issue

## What We Know

- Payment callbacks are working correctly (all payments go through)
- The upgrade logic exists in the code but isn't executing
- User upgraded Bronze → Gold, payment succeeded, but tier didn't update

## Most Likely Causes

### 1. Metadata Not Being Saved (Most Likely)

The `isUpgrade` and `newTier` metadata might not be getting saved to the database when the contribution is created.

**How to Check:**

```bash
# On dev server
npx ts-node scripts/check-user-metadata.ts "+254712345678"
```

Look for:

- Does the completed contribution have `isUpgrade: true`?
- Does it have `newTier: "GOLD"`?
- If NO → Frontend isn't sending the metadata correctly
- If YES → Backend isn't reading it correctly

### 2. Metadata Type Mismatch

The metadata might be saved as a string instead of boolean, causing the condition check to fail.

**Example:**

```json
{
  "isUpgrade": "true", // ❌ String, not boolean
  "newTier": "GOLD"
}
```

The code checks: `if (originalMetadata?.isUpgrade && ...)` which would fail if `isUpgrade` is the string `"true"`.

### 3. Metadata Lost During Update

When the contribution is updated to COMPLETED, the metadata might be getting overwritten instead of merged.

## Immediate Actions

### Step 1: Check User's Contribution Metadata

```bash
# SSH to dev server
ssh user@dev-server
cd /path/to/menodao-backend

# Check the user's contributions
npx ts-node scripts/check-user-metadata.ts "+254712345678"
```

This will show:

- All recent contributions
- Their metadata
- Whether upgrade metadata exists
- Type of each metadata field

### Step 2: Fix the User's Subscription

```bash
# Manually update the user to GOLD
npx ts-node scripts/fix-user-upgrade.ts "+254712345678" GOLD
```

### Step 3: Test Upgrade Flow

```bash
# Run test with detailed logging
npx ts-node scripts/test-upgrade-with-logs.ts
```

This will:

- Create a test member
- Set them to Bronze
- Create an upgrade contribution with metadata
- Verify metadata is saved correctly
- Simulate payment callback
- Check if upgrade processes

### Step 4: Deploy and Test

```bash
# Deploy the new logging
git pull origin dev
npm install
npm run build
pm2 restart menodao-backend

# Make a test upgrade payment
# Then check logs
./infrastructure/scripts/get-logs.sh dev 10 | grep "UPGRADE"
```

Look for these log messages:

```
[UPGRADE] Created upgrade contribution <id> with metadata: {...}
[UPGRADE DEBUG] Contribution <id> metadata: {...}
[UPGRADE DEBUG] isUpgrade: true, newTier: GOLD
[UPGRADE] Processing upgrade for member <id> to GOLD
[UPGRADE] ✅ Upgrade completed for member <id>: BRONZE -> GOLD
```

## Possible Fixes Based on Findings

### If Metadata is Missing

**Problem:** Frontend not sending `isUpgrade` and `newTier`

**Fix:** Check frontend PaymentDialog.tsx line 140:

```typescript
api.initiatePayment(
  amount,
  'MPESA',
  phoneNumber,
  isUpgrade, // ← Make sure this is true
  isUpgrade ? tier : undefined, // ← Make sure tier is set
);
```

### If Metadata is Wrong Type

**Problem:** `isUpgrade` is string `"true"` instead of boolean `true`

**Fix:** Update contributions.service.ts to ensure boolean:

```typescript
metadata: isUpgrade
  ? {
      isUpgrade: Boolean(isUpgrade),  // Force boolean
      newTier: newTier as PackageTier,
    }
  : undefined,
```

### If Metadata is Lost During Update

**Problem:** Metadata overwritten when contribution updated to COMPLETED

**Fix:** Already fixed in payment.service.ts line 250:

```typescript
const originalMetadata = contribution.metadata as {...};
// Extract BEFORE update
```

### If Condition Check Fails

**Problem:** Condition `if (originalMetadata?.isUpgrade && originalMetadata?.newTier)` fails

**Fix:** Add explicit checks:

```typescript
if (
  originalMetadata &&
  originalMetadata.isUpgrade === true &&
  originalMetadata.newTier &&
  typeof originalMetadata.newTier === 'string'
) {
  // Process upgrade
}
```

## Monitoring After Fix

### Add CloudWatch Alarm

Create alarm for:

- Contributions with `isUpgrade: true` that don't result in subscription update
- Log pattern: `UPGRADE DEBUG.*Not an upgrade payment`

### Add Frontend Verification

After payment completes, verify tier updated:

```typescript
// In PaymentDialog.tsx
if (isUpgrade && paymentStatus === 'COMPLETED') {
  const subscription = await api.getCurrentSubscription();
  if (subscription.tier !== tier) {
    // Alert user and log error
    console.error('Upgrade verification failed', {
      expected: tier,
      actual: subscription.tier,
      contributionId,
    });
  }
}
```

### Add Database Trigger (Optional)

Create a trigger to log when contributions with upgrade metadata are completed:

```sql
CREATE OR REPLACE FUNCTION log_upgrade_completion()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'COMPLETED' AND
     NEW.metadata->>'isUpgrade' = 'true' THEN
    RAISE NOTICE 'Upgrade contribution completed: % -> %',
      NEW.id, NEW.metadata->>'newTier';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER upgrade_completion_log
AFTER UPDATE ON "Contribution"
FOR EACH ROW
EXECUTE FUNCTION log_upgrade_completion();
```

## Summary

1. **Check metadata** with `check-user-metadata.ts`
2. **Fix user** with `fix-user-upgrade.ts`
3. **Test flow** with `test-upgrade-with-logs.ts`
4. **Deploy** new logging code
5. **Monitor** logs for `[UPGRADE]` messages
6. **Verify** with another test upgrade

The new logging will show exactly where the upgrade flow is breaking.

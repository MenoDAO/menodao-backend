# Package Upgrade Debugging Guide

## Issue Summary

User upgraded from Bronze to Gold tier. Payment completed successfully, but the subscription tier did not update in the database.

## Diagnostic Steps

### Step 1: Run Diagnostic Script on Dev Server

SSH into the dev server and run:

```bash
cd /path/to/menodao-backend
npx ts-node scripts/diagnose-upgrade-issue.ts "+254712345678"
```

This will show:

- Current subscription tier
- Recent contributions with metadata
- Any completed upgrade contributions that didn't process
- Recommended fix command

### Step 2: Check Backend Logs

Look for the upgrade processing log message:

```bash
cd infrastructure/scripts
./get-logs.sh dev 60 | grep "Processing upgrade"
```

You should see a log like:

```
Processing upgrade for member <member-id> to GOLD
```

If this log is MISSING, it means:

1. The payment callback didn't receive the upgrade metadata, OR
2. The backend code running on dev is not the latest version

### Step 3: Verify Deployed Code

Check the latest commits on dev:

```bash
git log --oneline -5
```

Expected commits:

- `cf64d9c` - Fix upgrade metadata extraction
- `32f021b` - Add upgrade processing logic

If these commits are NOT deployed, the dev server is running old code.

### Step 4: Check Database Directly

Connect to the database and check the contribution metadata:

```sql
SELECT
  c.id,
  c.status,
  c.amount,
  c.metadata,
  c."createdAt",
  c."updatedAt",
  m."phoneNumber",
  s.tier as current_tier
FROM "Contribution" c
JOIN "Member" m ON c."memberId" = m.id
LEFT JOIN "Subscription" s ON m.id = s."memberId"
WHERE m."phoneNumber" = '+254712345678'
  AND c.status = 'COMPLETED'
ORDER BY c."createdAt" DESC
LIMIT 5;
```

Look for:

- `metadata` field should contain: `{"isUpgrade": true, "newTier": "GOLD"}`
- If metadata is missing or incorrect, the frontend didn't send it properly

## Fix Options

### Option 1: Manual Database Fix (Immediate)

If the diagnostic script confirms a completed upgrade that didn't process:

```bash
npx ts-node scripts/fix-user-upgrade.ts "+254712345678" GOLD
```

This will:

- Update subscription tier to GOLD
- Update monthlyAmount to 700
- Update annualCapLimit to 15000

### Option 2: Redeploy Backend (Prevents Future Issues)

If the backend is running old code:

```bash
# On dev server
cd /path/to/menodao-backend
git pull origin dev
npm install
npm run build
pm2 restart menodao-backend
```

Then verify the deployment:

```bash
pm2 logs menodao-backend --lines 50
```

### Option 3: Test Upgrade Flow Again

After fixing the user's subscription, test the upgrade flow with a test account:

```bash
# Run the test script
npx ts-node scripts/test-upgrade-flow.ts
```

This will:

1. Create/find a test member
2. Set them to Bronze tier
3. Simulate an upgrade to Gold
4. Verify the tier updates correctly

## Root Cause Analysis

### Possible Causes

1. **Deployment Issue** (Most Likely)
   - Latest code (commits cf64d9c, 32f021b) not deployed to dev
   - Backend still running old version without upgrade processing logic

2. **Metadata Not Sent**
   - Frontend didn't send `isUpgrade: true` and `newTier` in payment request
   - Check browser network tab for `/contributions/pay` request body

3. **Callback Timing Issue**
   - Payment callback arrived before contribution was created
   - Metadata was lost during contribution update

4. **Database Transaction Issue**
   - Subscription update failed silently
   - Check for database errors in logs

### How the Upgrade Should Work

1. **Frontend**: User clicks "Upgrade" button

   ```typescript
   api.upgrade(tier); // Returns upgrade cost
   api.initiatePayment(amount, 'MPESA', phone, true, tier);
   ```

2. **Backend**: Create contribution with metadata

   ```typescript
   await prisma.contribution.create({
     data: {
       memberId,
       amount,
       status: 'PENDING',
       metadata: {
         isUpgrade: true,
         newTier: 'GOLD',
       },
     },
   });
   ```

3. **Payment Callback**: Extract metadata BEFORE updating

   ```typescript
   const originalMetadata = contribution.metadata as {
     isUpgrade?: boolean;
     newTier?: PackageTier;
   } | null;

   // Update contribution to COMPLETED
   await prisma.contribution.update({ ... });

   // Process upgrade using originalMetadata
   if (originalMetadata?.isUpgrade && originalMetadata?.newTier) {
     await prisma.subscription.update({
       where: { memberId },
       data: {
         tier: originalMetadata.newTier,
         monthlyAmount: tierPrices[originalMetadata.newTier],
         annualCapLimit: tierCaps[originalMetadata.newTier]
       }
     });
   }
   ```

## Prevention

### Add Monitoring

Add a CloudWatch alarm for failed upgrades:

```typescript
// In payment.service.ts, after upgrade processing
if (originalMetadata?.isUpgrade) {
  this.logger.log(
    `✅ Upgrade completed: ${contribution.memberId} -> ${originalMetadata.newTier}`,
  );
} else if (originalMetadata?.isUpgrade === true && !originalMetadata?.newTier) {
  this.logger.error(`❌ Upgrade metadata incomplete for ${contribution.id}`);
}
```

### Add Database Constraint

Ensure subscription updates are atomic:

```typescript
// Use transaction for upgrade
await prisma.$transaction([
  prisma.contribution.update({ ... }),
  prisma.subscription.update({ ... })
]);
```

### Add Frontend Verification

After payment completes, verify the tier updated:

```typescript
// In PaymentDialog.tsx
const verifyUpgrade = async () => {
  const subscription = await api.getCurrentSubscription();
  if (subscription.tier !== expectedTier) {
    // Alert user and admin
    console.error('Upgrade verification failed');
  }
};
```

## Contact

If the issue persists after trying all fixes:

1. Check CloudWatch logs for errors
2. Verify database connectivity
3. Check SasaPay callback logs
4. Contact backend team with diagnostic script output

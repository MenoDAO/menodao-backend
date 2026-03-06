# URGENT: Package Upgrade Not Working - Action Plan

## Current Situation

- User upgraded Bronze → Gold
- Payment completed successfully (funds deducted)
- Dashboard still shows Bronze tier
- Need to ship TODAY

## Immediate Fix (5 minutes)

### Step 1: SSH into Dev Server

```bash
ssh user@dev-server
cd /path/to/menodao-backend
```

### Step 2: Run Diagnostic Script

```bash
npx ts-node scripts/diagnose-upgrade-issue.ts "+254712345678"
```

This will show:

- Current tier (should show BRONZE)
- Recent contributions with metadata
- Whether upgrade metadata was saved
- Recommended fix command

### Step 3: Manual Fix (if diagnostic confirms issue)

```bash
npx ts-node scripts/fix-user-upgrade.ts "+254712345678" GOLD
```

This will immediately update the user's subscription to GOLD tier.

### Step 4: Verify Fix

```bash
# Check the subscription was updated
npx ts-node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.member.findUnique({
  where: { phoneNumber: '+254712345678' },
  include: { subscription: true }
}).then(m => {
  console.log('Current tier:', m?.subscription?.tier);
  console.log('Monthly amount:', m?.subscription?.monthlyAmount);
  console.log('Annual cap:', m?.subscription?.annualCapLimit);
  process.exit(0);
});
"
```

Expected output:

```
Current tier: GOLD
Monthly amount: 700
Annual cap: 15000
```

## Root Cause Investigation (10 minutes)

### Check if Latest Code is Deployed

```bash
# On dev server
cd /path/to/menodao-backend
git log --oneline -5
```

Expected commits:

- `32f021b` - fix: sync database schema and add upgrade flow test
- `cf64d9c` - fix: preserve upgrade metadata during payment callback
- `d20097f` - feat: implement package upgrade logic

If these are MISSING, the dev server is running old code!

### Check Backend Logs

```bash
cd infrastructure/scripts
./get-logs.sh dev 60 | grep -i upgrade
```

Look for:

```
Processing upgrade for member <id> to GOLD
```

If this log is MISSING, it means:

1. The payment callback didn't receive upgrade metadata, OR
2. The backend is running old code

### Check Database Metadata

```bash
npx ts-node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.contribution.findMany({
  where: {
    member: { phoneNumber: '+254712345678' },
    status: 'COMPLETED'
  },
  orderBy: { createdAt: 'desc' },
  take: 3
}).then(contributions => {
  contributions.forEach(c => {
    console.log('ID:', c.id);
    console.log('Status:', c.status);
    console.log('Metadata:', JSON.stringify(c.metadata, null, 2));
    console.log('---');
  });
  process.exit(0);
});
"
```

Look for metadata like:

```json
{
  "isUpgrade": true,
  "newTier": "GOLD"
}
```

If metadata is MISSING, the frontend didn't send it!

## Deployment Fix (if needed)

If the dev server is running old code:

```bash
# On dev server
cd /path/to/menodao-backend
git pull origin dev
npm install
npm run build

# Restart the backend
pm2 restart menodao-backend

# Verify it's running
pm2 logs menodao-backend --lines 20
```

## Testing the Fix

After fixing the user's subscription, test with a new upgrade:

```bash
# Run the test script
npx ts-node scripts/test-upgrade-flow.ts
```

This will:

1. Create a test member with Bronze tier
2. Simulate an upgrade to Gold
3. Verify the tier updates correctly

Expected output:

```
✅ SUCCESS: Upgrade completed successfully!
```

## Prevention for Future

### Add Monitoring Alert

Add to CloudWatch:

- Alert when contribution has `isUpgrade: true` but subscription doesn't update within 5 minutes
- Alert when payment callback doesn't contain expected metadata

### Add Frontend Verification

After payment completes, verify the tier:

```typescript
// In PaymentDialog.tsx, after payment success
if (isUpgrade) {
  const subscription = await api.getCurrentSubscription();
  if (subscription.tier !== expectedTier) {
    // Show error to user
    alert(
      'Upgrade payment received but tier not updated. Please contact support.',
    );
    // Log to monitoring
    console.error('Upgrade verification failed', {
      expected: expectedTier,
      actual: subscription.tier,
    });
  }
}
```

### Add Database Transaction

Wrap upgrade in transaction:

```typescript
await prisma.$transaction([
  prisma.contribution.update({ ... }),
  prisma.subscription.update({ ... })
]);
```

## Quick Reference

### Scripts Created

1. `scripts/diagnose-upgrade-issue.ts` - Diagnose what went wrong
2. `scripts/fix-user-upgrade.ts` - Manually fix a user's subscription
3. `scripts/test-upgrade-flow.ts` - Test the upgrade flow end-to-end
4. `scripts/check-deployment.sh` - Check if latest code is deployed

### Key Files

1. `src/payments/payment.service.ts` (line 280) - Upgrade processing logic
2. `src/contributions/contributions.service.ts` (line 73) - Metadata setting
3. `src/subscriptions/subscriptions.service.ts` - Upgrade validation

### Important Log Messages

- `Processing upgrade for member X to Y` - Upgrade is being processed
- `Upgrade completed for member X to Y` - Upgrade succeeded
- `No subscription found for member X during upgrade` - Upgrade failed

## Contact

If issue persists:

1. Share output of diagnostic script
2. Share backend logs (last 60 minutes)
3. Share database query results
4. Check if SasaPay callbacks are being received

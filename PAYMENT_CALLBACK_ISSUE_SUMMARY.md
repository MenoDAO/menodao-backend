# Payment Callback Issue - Investigation Summary

## Problem

Users are seeing "Payment Failed" errors even though:

- Money was deducted from their M-Pesa account
- Payment is settled in SasaPay/provider account
- The payment actually succeeded

## Root Cause Analysis

### 1. Callback URL Configuration

The callback URL is configured in `sasapay.service.ts`:

```typescript
// Production callback URL
const callbackUrl = `${this.callbackBaseUrl}/contributions/callback`;
// Should be: https://api.menodao.org/contributions/callback
```

**Environment Variable**: `API_BASE_URL`

- Dev: `https://dev-api.menodao.org`
- Prod: `https://api.menodao.org`

### 2. Callback Not Reaching Server

Investigation shows:

- ✅ Dev environment: Callbacks working fine
- ❌ Production: No callback logs found in CloudWatch
- Production log stream: `prod/menodao-backend/901d3885f22a4e5e88206702977dc32c`
- Last 2 hours: No callback-related logs

### 3. Possible Issues

#### A. Wrong Callback URL

If `API_BASE_URL` is not set correctly in production ECS task definition:

- SasaPay might be hitting wrong URL
- Callbacks fail silently
- Database never gets updated

#### B. Network/Firewall Issues

- SasaPay callbacks might be blocked by security groups
- Load balancer might not be routing `/contributions/callback` correctly
- SSL/TLS certificate issues

#### C. Production Not Deployed

- The merge to main just happened
- Production deployment might still be in progress
- Old code doesn't have the improved logging

## Fixes Implemented

### 1. Frontend Timeout Extension (✅ Deployed)

**File**: `menodao-frontend/src/app/(dashboard)/dashboard/subscription/PaymentDialog.tsx`

- Extended polling timeout from 2 to 5 minutes
- Added manual "Check Status Now" button
- Better timeout messaging

### 2. Backend Callback Improvements (🔄 Pending Deployment)

**Files**:

- `menodao-backend/src/payments/payment.service.ts`
- `menodao-backend/src/sasapay/sasapay.service.ts`

Changes:

- Allow callbacks to update FAILED payments (handle retries)
- Comprehensive logging for debugging
- Log callback URL on startup
- Better error messages

### 3. Payment Reconciliation Script (✅ Created)

**File**: `menodao-backend/scripts/reconcile-failed-payments.ts`

Purpose:

- Query SasaPay API to verify payment status
- Update database for payments that succeeded but marked as FAILED
- Activate subscriptions for corrected payments

## Action Items

### Immediate (Critical)

1. **Verify Production Callback URL**

   ```bash
   # Check ECS task definition environment variables
   aws ecs describe-task-definition --task-definition menodao-api-prod \
     --query 'taskDefinition.containerDefinitions[0].environment' \
     --region us-east-1
   ```

   Look for: `API_BASE_URL=https://api.menodao.org`

2. **Check Production Deployment Status**

   ```bash
   # Check if latest code is deployed
   aws ecs list-tasks --cluster menodao-prod --region us-east-1
   aws ecs describe-tasks --cluster menodao-prod --tasks <task-arn> --region us-east-1
   ```

3. **Test Callback Endpoint**

   ```bash
   # Test if endpoint is reachable
   curl -X POST https://api.menodao.org/contributions/callback \
     -H "Content-Type: application/json" \
     -d '{"test": "data"}'
   ```

4. **Run Reconciliation Script**
   For the 6 failed payments:
   ```bash
   cd menodao-backend
   npx ts-node scripts/reconcile-failed-payments.ts
   ```

### Short Term

5. **Monitor Production Logs**
   After deployment, check for:
   - "SasaPay callback URL configured: ..." on startup
   - "Processing SasaPay callback: ..." when payments occur
   - Any callback-related errors

6. **Verify SasaPay Configuration**
   - Confirm production SasaPay credentials are correct
   - Verify merchant code matches production account
   - Check if callback URL is whitelisted in SasaPay dashboard

### Long Term

7. **Add Callback Monitoring**
   - Set up CloudWatch alarms for missing callbacks
   - Track callback success/failure rates
   - Alert when payments stay PENDING > 10 minutes

8. **Implement Fallback Verification**
   - Periodic job to check PENDING payments
   - Query SasaPay status API for old PENDING payments
   - Auto-update status if payment succeeded

9. **Add Admin Tools**
   - UI for admins to manually verify payments
   - Button to trigger reconciliation for specific payment
   - Dashboard showing payment status discrepancies

## Testing Checklist

After deployment:

- [ ] Check production logs show callback URL on startup
- [ ] Make a test payment in production
- [ ] Verify callback is received and logged
- [ ] Confirm payment status updates to COMPLETED
- [ ] Verify subscription is activated
- [ ] Check SMS notification is sent
- [ ] Run reconciliation script for failed payments
- [ ] Verify affected users can now access their subscriptions

## Failed Payment References

These payments need reconciliation:

1. `menodao_mmeng45l4c5926fc`
2. `menodao_mmenec7388129d91`
3. `menodao_mmemf2dpe43c78b5`
4. `menodao_mmd7ra5dd08cdc05`
5. `menodao_mmayuwm0ecc6a6ab`
6. `menodao_mmawh6yxb0276728`

## Environment Variables to Verify

Production ECS Task Definition should have:

```
NODE_ENV=production
API_BASE_URL=https://api.menodao.org
SASAPAY_BASE_URL=https://api.sasapay.app  # NOT sandbox
SASAPAY_CLIENT_ID=<production_client_id>
SASAPAY_CLIENT_SECRET=<production_secret>
SASAPAY_MERCHANT_CODE=<production_merchant_code>
DATABASE_URL=<production_database_url>
```

## Contact Points

If callbacks still fail after fixes:

1. Check SasaPay dashboard for callback delivery status
2. Contact SasaPay support to verify callback URL
3. Check AWS CloudWatch logs for any errors
4. Verify security groups allow inbound HTTPS from SasaPay IPs

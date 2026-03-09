# Payment Reconciliation Script

This script verifies payment transactions with SasaPay and updates database records for payments that were marked as FAILED but actually succeeded.

## Problem

Sometimes payments are marked as FAILED in our database even though:

1. The money was collected from the customer
2. The transaction succeeded on SasaPay/M-Pesa side
3. The callback was delayed or not processed correctly

This creates a bad user experience where customers paid but don't get their subscription activated.

## Solution

This script:

1. Queries SasaPay's transaction status API for each payment reference
2. Compares the actual status with our database status
3. Updates FAILED payments to COMPLETED if they actually succeeded
4. Activates subscriptions for corrected payments

## Usage

### Prerequisites

1. Ensure you have production database access
2. Have SasaPay API credentials configured in `.env`:
   ```
   SASAPAY_CLIENT_ID=your_client_id
   SASAPAY_CLIENT_SECRET=your_client_secret
   SASAPAY_BASE_URL=https://api.sasapay.app  # or sandbox URL
   DATABASE_URL=your_production_database_url
   ```

### Running the Script

```bash
# From the backend directory
cd menodao-backend

# Install dependencies if needed
npm install

# Run the script
npx ts-node scripts/reconcile-failed-payments.ts
```

### Output

The script will:

- Show each payment being checked
- Display database record details
- Query SasaPay for actual transaction status
- Update records if discrepancies are found
- Activate subscriptions for corrected payments

Example output:

```
================================================================================
Checking payment: menodao_mmeng45l4c5926fc
================================================================================

Database Record:
  Contribution ID: abc123
  Member: Jane Doe (254712345678)
  Amount: KES 700
  Status: FAILED
  Created: 2026-03-05T10:30:00.000Z

SasaPay Response:
  Status: true
  Transaction Status: Success
  Result Code: 0
  M-Pesa Receipt: QAB1CD2EFG
  Amount: 700

✅ PAYMENT WAS SUCCESSFUL BUT MARKED AS FAILED!
   Updating database record...
   ✅ Subscription activated
   ✅ Payment record updated to COMPLETED
```

## Payment References to Check

The script currently checks these payment references:

- menodao_mmeng45l4c5926fc
- menodao_mmenec7388129d91
- menodao_mmemf2dpe43c78b5
- menodao_mmd7ra5dd08cdc05
- menodao_mmayuwm0ecc6a6ab
- menodao_mmawh6yxb0276728

To check additional payments, edit the `PAYMENT_REFS_TO_CHECK` array in the script.

## Safety

- The script only updates FAILED → COMPLETED (never the reverse)
- It verifies with SasaPay before making any changes
- All changes are logged for audit purposes
- Subscriptions are only activated if payment is confirmed successful

## SasaPay API Reference

Transaction Status API:

- Endpoint: `GET /api/v1/payments/check-payment-status/`
- Parameter: `CheckoutRequestID` (the merchant request ID)
- Documentation: https://developer.sasapay.app/docs/apis/transaction-status

## Troubleshooting

### "Payment not found in database"

- Check that the payment reference is correct
- Verify you're connected to the right database (dev vs prod)

### "Status check failed"

- Verify SasaPay credentials are correct
- Check that the CheckoutRequestID exists in SasaPay
- Ensure you have network access to SasaPay API

### "Authentication failed"

- Check SASAPAY_CLIENT_ID and SASAPAY_CLIENT_SECRET
- Verify credentials are for the correct environment (sandbox vs production)

## Next Steps

After running the script:

1. Verify the updated payments in the admin dashboard
2. Check that affected users' subscriptions are now active
3. Consider notifying affected users that their payments have been processed
4. Monitor for similar issues and investigate root cause

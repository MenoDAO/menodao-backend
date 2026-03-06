# Phone Number Investigation Results

## Issue Summary

User reported that their subscription shows phone number "+254712345678" which is not their real number, but OTP was sent to their real number during login.

## Investigation Findings

### 1. Database Analysis

- **Only ONE member exists** in the database with phone number: `+254712345678`
- **Member Details:**
  - ID: `44972f17-ef8e-4011-a54b-47b2789b5315`
  - Name: "Test Upgrade User"
  - Location: Not set
  - Created: Thu Mar 05 2026 15:41:34 GMT+0300
  - Verified: true
  - Subscription: GOLD (Active)

### 2. OTP Records

- **ZERO OTP codes** found in the database (all time)
- This confirms the account was NOT created through the normal signup/OTP flow

### 3. Source of Test Data

The member was created by the test script: `scripts/test-upgrade-flow.ts`

```typescript
const testPhone = '+254712345678';
member = await prisma.member.create({
  data: {
    phoneNumber: testPhone,
    fullName: 'Test Upgrade User',
    isVerified: true,
  },
});
```

### 4. Payment Records

The test account has 2 contributions:

1. `test-upgrade-1772714694082` - KES 350 - COMPLETED
2. `test-upgrade-1772714594772` - KES 350 - PENDING

Both have IDs starting with "test-upgrade-" confirming they're test data.

## Root Cause Analysis

### The Account is Test Data

The phone number "+254712345678" is:

- Used as a placeholder in UI forms (e.g., `placeholder="0712345678"`)
- Used in test scripts as the default test phone number
- Used in unit tests throughout the codebase
- **NOT a real user account**

### Why No Real User Accounts?

The database appears to be in a test/development state with only test data. There are no real user accounts created through the normal signup flow.

## Possible Scenarios

### Scenario 1: User is Logged Into Test Account

- User may have logged in using test credentials during development
- The test account is showing in their dashboard
- When they try to use real phone number for payments, it conflicts with test data

### Scenario 2: Database Needs Reset

- The production/staging database may have been seeded with test data
- Real user signups are not working or not being saved
- Need to clear test data and verify signup flow works

### Scenario 3: Frontend/Backend Mismatch

- Frontend might be caching old test data
- User's real account might exist but frontend is showing cached test account
- Need to clear browser storage and re-authenticate

## Recommended Actions

### Immediate Actions

1. **Verify Environment**: Confirm whether this is development, staging, or production
2. **Check for Real Users**: Run query to see if any members have OTP records
3. **Clear Test Data**: Delete the test member account if in production
4. **Test Signup Flow**: Create a new account with a real phone number to verify OTP flow works

### Database Cleanup

```sql
-- Check if there are any real users (with OTP records)
SELECT m.*, COUNT(o.id) as otp_count
FROM "Member" m
LEFT JOIN "OTPCode" o ON o."memberId" = m.id
GROUP BY m.id;

-- If no real users exist, clear test data
DELETE FROM "Contribution" WHERE id LIKE 'test-%';
DELETE FROM "Subscription" WHERE "memberId" = '44972f17-ef8e-4011-a54b-47b2789b5315';
DELETE FROM "Member" WHERE "phoneNumber" = '+254712345678';
```

### Verification Steps

1. Clear browser localStorage and sessionStorage
2. Log out completely
3. Sign up with a real phone number
4. Verify OTP is sent and received
5. Complete signup and check database for new member record
6. Verify new member has correct phone number

## Prevention Measures

### 1. Separate Test Data

- Use a separate test database for running test scripts
- Never run test scripts against production database
- Add environment checks to test scripts

### 2. Test Script Safety

Add to all test scripts:

```typescript
if (process.env.NODE_ENV === 'production') {
  console.error('ERROR: Cannot run test scripts in production!');
  process.exit(1);
}
```

### 3. Phone Number Validation

- Add validation to prevent test phone numbers in production
- Block phone numbers that match common test patterns
- Log warnings when test data is detected

## Next Steps

1. **User Action Required**: Ask user to:
   - Confirm which environment they're using (dev/staging/prod)
   - Try logging out and signing up with their real phone number
   - Check if they receive OTP on their real number
   - Verify the phone number shown after successful signup

2. **Developer Action Required**:
   - Check database environment and clear test data if needed
   - Verify OTP service is working correctly
   - Test complete signup flow end-to-end
   - Add safeguards to prevent test data in production

## Conclusion

The phone number "+254712345678" is test data created by a development script. The account showing this number is not a real user account. The user needs to create a new account through the proper signup flow, or the existing test data needs to be cleared from the database.

The fact that there are ZERO OTP records in the database is the smoking gun - no real users have signed up through the normal flow yet.

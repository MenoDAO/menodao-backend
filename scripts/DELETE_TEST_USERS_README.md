# Delete Test Users Script

This script safely deletes specific test users and all their related records from the database.

## ⚠️ IMPORTANT SAFETY NOTES

1. **The script uses a separate config file** (`delete-test-users.config.ts`) that is gitignored
2. **Never commit the config file** - it stays local only to protect database credentials
3. The script has a safety check that will prevent execution if it detects a production database
4. You will be prompted to confirm before any deletions occur

## Current Test Users to Delete

- `0713278107`
- `0794969151`

## Setup (First Time Only)

### Step 1: Create Config File

Copy the example config file:

```bash
cd scripts
cp delete-test-users.config.example.ts delete-test-users.config.ts
```

### Step 2: Update Config File

Edit `delete-test-users.config.ts` and update the `DATABASE_URL` to point to your **dev database**:

```typescript
export const config = {
  // Update this to your dev database URL
  DATABASE_URL:
    'postgresql://user:password@dev-host:5432/menodao_dev?sslmode=require',

  // Phone numbers to delete
  PHONE_NUMBERS: ['0713278107', '0794969151'],
};
```

**Note:** The config file is gitignored and will never be committed to the repository.

## How to Use

Once you've set up the config file, run:

```bash
npx ts-node scripts/delete-test-users.ts
```

### Confirm Deletion

The script will show you:

- Database host
- Database name
- Phone numbers to be deleted

Type `yes` to confirm or `no` to cancel.

## What Gets Deleted

For each user, the script deletes (in order):

1. Questionnaire data
2. Visit procedures
3. Disbursal status history
4. Disbursals
5. Visits
6. Claims
7. Camp registrations
8. Device tokens
9. Blockchain transactions
10. NFTs
11. OTP codes
12. Contributions (payments)
13. Subscription
14. Member record

## Safety Features

- **Production database check**: Exits if it detects an AWS RDS production database
- **Confirmation prompt**: Requires explicit "yes" to proceed
- **Database info display**: Shows which database will be affected
- **User-not-found handling**: Skips gracefully if a user doesn't exist
- **Gitignored config**: Database credentials never get committed

## Example Output

```
⚠️  DATABASE CLEANUP SCRIPT ⚠️
================================
📊 Database Host: dev-db.example.com
📊 Database Name: menodao_dev
📱 Phone numbers to delete: 0713278107, 0794969151
================================

Are you sure you want to delete these users? (yes/no): yes

🗑️  Starting cleanup of test users...

🔍 Looking for user: 0713278107
   ✅ Found user: Test User (ID: abc-123)
   🗑️  Deleted 2 questionnaire records
   🗑️  Deleted 5 visit procedures
   🗑️  Deleted 3 visits
   🗑️  Deleted 1 claims
   🗑️  Deleted 2 contributions
   🗑️  Deleted subscription (BRONZE)
   ✅ Deleted member: 0713278107

✨ Cleanup complete!
```

## Troubleshooting

### "This appears to be a PRODUCTION database!"

The script detected you're connected to production. Update your `delete-test-users.config.ts` file to point to the dev database.

### "Cannot find module './delete-test-users.config'"

You need to create the config file first. Run:

```bash
cp scripts/delete-test-users.config.example.ts scripts/delete-test-users.config.ts
```

Then edit the file to add your dev database URL.

### "User not found"

The user with that phone number doesn't exist in the database. This is normal if they've already been deleted or never existed.

### Database connection errors

Make sure:

- Your DATABASE_URL in the config file is correct
- The database is accessible
- You have the necessary permissions

## Adding More Users

To delete additional users, edit `delete-test-users.config.ts` and add phone numbers to the `PHONE_NUMBERS` array:

```typescript
PHONE_NUMBERS: ['0713278107', '0794969151', '0700000000'],
```

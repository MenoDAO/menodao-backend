/**
 * Configuration for delete-test-users script
 *
 * INSTRUCTIONS:
 * 1. Copy this file to delete-test-users.config.ts
 * 2. Update the DATABASE_URL to point to your dev database
 * 3. Update PHONE_NUMBERS if needed
 *
 * The .config.ts file is gitignored and will stay local only!
 */

export const config = {
  // Update this to your dev database URL
  // Example: "postgresql://user:password@dev-host:5432/menodao_dev?sslmode=require"
  DATABASE_URL: 'YOUR_DEV_DATABASE_URL_HERE',

  // Phone numbers to delete
  PHONE_NUMBERS: ['0713278107', '0794969151'],
};

#!/usr/bin/env node

/**
 * Database Environment Validation Script
 *
 * Ensures that the DATABASE_URL matches the NODE_ENV to prevent
 * accidental data pollution between dev and prod environments.
 */

const dbUrl = process.env.DATABASE_URL;
const nodeEnv = process.env.NODE_ENV || 'development';

console.log('🔍 Validating database configuration...');
console.log(`   Environment: ${nodeEnv}`);

if (!dbUrl) {
  console.error('❌ ERROR: DATABASE_URL environment variable is not set');
  process.exit(1);
}

// Extract database name from URL
// Format: postgresql://user:pass@host:port/dbname?params
const match = dbUrl.match(/\/([^/?]+)(\?|$)/);
const dbName = match ? match[1] : null;

// Extract host from URL
const hostMatch = dbUrl.match(/@([^:\/]+)/);
const dbHost = hostMatch ? hostMatch[1] : null;

console.log(`   Database: ${dbName}`);
console.log(`   Host: ${dbHost}`);

if (!dbName) {
  console.error('❌ ERROR: Could not extract database name from DATABASE_URL');
  process.exit(1);
}

// Validation rules
const validationRules = {
  production: {
    allowedDbNames: [
      'menodao_prod',
      'menodao-prod',
      'menodao_production',
      'menodao-production',
    ],
    allowedHosts: ['menodao-production', 'masterpg'], // Allow masterpg for transition period
    errorMessage: 'Production environment must use a production database',
  },
  development: {
    allowedDbNames: [
      'menodao_dev',
      'menodao-dev',
      'menodao_development',
      'menodao-development',
    ],
    allowedHosts: ['menodao-dev', 'masterpg', 'localhost'], // Allow masterpg for transition period
    errorMessage: 'Development environment must use a development database',
  },
  staging: {
    allowedDbNames: [
      'menodao_stg',
      'menodao-stg',
      'menodao_staging',
      'menodao-staging',
    ],
    allowedHosts: ['menodao-staging', 'masterpg'],
    errorMessage: 'Staging environment must use a staging database',
  },
};

// Get validation rules for current environment
const rules = validationRules[nodeEnv] || validationRules.development;

// Check database name
const dbNameValid = rules.allowedDbNames.some((allowed) =>
  dbName.toLowerCase().includes(allowed.toLowerCase()),
);

// Check host (less strict - just warn if suspicious)
const hostValid = rules.allowedHosts.some((allowed) =>
  dbHost.toLowerCase().includes(allowed.toLowerCase()),
);

// Validation results
let hasErrors = false;
let hasWarnings = false;

if (!dbNameValid) {
  console.error('❌ CRITICAL ERROR: Database name validation failed!');
  console.error(`   ${rules.errorMessage}`);
  console.error(`   Current database: ${dbName}`);
  console.error(`   Allowed databases: ${rules.allowedDbNames.join(', ')}`);
  hasErrors = true;
}

if (!hostValid) {
  console.warn('⚠️  WARNING: Database host may not match environment');
  console.warn(`   Current host: ${dbHost}`);
  console.warn(`   Expected hosts: ${rules.allowedHosts.join(', ')}`);
  hasWarnings = true;
}

// Special check: Prevent prod from using shared database
if (nodeEnv === 'production' && dbName === 'menodao') {
  console.error(
    '❌ CRITICAL ERROR: Production cannot use shared "menodao" database!',
  );
  console.error('   This database may contain dev/test data.');
  console.error('   Use menodao_prod or menodao-production instead.');
  hasErrors = true;
}

// Special check: Warn if dev uses production database
if (
  nodeEnv === 'development' &&
  (dbName.includes('prod') || dbName.includes('production'))
) {
  console.error(
    '❌ CRITICAL ERROR: Development environment attempting to use production database!',
  );
  console.error(`   Database: ${dbName}`);
  console.error('   This could corrupt production data!');
  hasErrors = true;
}

// Summary
console.log('');
if (hasErrors) {
  console.error('❌ Database validation FAILED');
  console.error('   Deployment aborted to prevent data corruption');
  console.error('   Please check your DATABASE_URL configuration');
  process.exit(1);
}

if (hasWarnings) {
  console.warn('⚠️  Database validation passed with warnings');
  console.warn('   Please review the warnings above');

  // In CI/CD, treat warnings as errors for production
  if (nodeEnv === 'production' && process.env.CI === 'true') {
    console.error('❌ Warnings treated as errors in production CI/CD');
    process.exit(1);
  }
}

console.log('✅ Database validation passed');
console.log(`   Safe to proceed with ${nodeEnv} deployment`);
process.exit(0);

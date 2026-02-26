# Manual Database Setup Steps

Since the automated script requires interactive password input, here are the manual SQL commands:

## Step 1: Connect to PostgreSQL

```bash
psql -h ***REMOVED*** -U ***REMOVED*** -d postgres
```

## Step 2: Rename Current Database to Dev

```sql
-- Disconnect all connections to menodao database first
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'menodao' AND pid <> pg_backend_pid();

-- Rename to menodao_dev
ALTER DATABASE menodao RENAME TO menodao_dev;
```

## Step 3: Create Fresh Production Database

```sql
-- Create production database
CREATE DATABASE menodao_prod;

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE menodao_prod TO ***REMOVED***;
```

## Step 4: Run Migrations on Production

```bash
# Set environment variable
export DATABASE_URL="postgresql://***REMOVED***:***REMOVED***@***REMOVED***:5432/menodao_prod?sslmode=require"

# Run migrations
npx prisma migrate deploy
```

## Step 5: Verify Setup

```bash
# List databases
psql -h ***REMOVED*** -U ***REMOVED*** -d postgres -c "\l"
```

You should see:

- `menodao_dev` (your current data)
- `menodao_prod` (fresh, empty)

## Step 6: Update AWS Secrets Manager

### Dev Environment

```bash
aws secretsmanager get-secret-value \
  --secret-id menodao/dev/app \
  --region us-east-1 \
  --query SecretString \
  --output text > /tmp/dev-secret.json

# Edit the file to update DATABASE_URL to use menodao_dev
# Then update:
aws secretsmanager update-secret \
  --secret-id menodao/dev/app \
  --secret-string file:///tmp/dev-secret.json \
  --region us-east-1
```

### Prod Environment

```bash
aws secretsmanager get-secret-value \
  --secret-id menodao/production/app \
  --region us-east-1 \
  --query SecretString \
  --output text > /tmp/prod-secret.json

# Edit the file to update DATABASE_URL to use menodao_prod
# Then update:
aws secretsmanager update-secret \
  --secret-id menodao/production/app \
  --secret-string file:///tmp/prod-secret.json \
  --region us-east-1
```

## Step 7: Restart ECS Services

```bash
# Force new deployment for dev
aws ecs update-service \
  --cluster menodao \
  --service menodao-api-dev \
  --force-new-deployment \
  --region us-east-1

# Force new deployment for prod
aws ecs update-service \
  --cluster menodao-prod \
  --service menodao-api \
  --force-new-deployment \
  --region us-east-1
```

## Done!

Your databases are now separated:

- Dev: `menodao_dev` (all your current data)
- Prod: `menodao_prod` (fresh, clean)

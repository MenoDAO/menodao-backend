# Database Environment Separation

## Problem

Dev and prod share the same `menodao` database, causing data pollution.

## Solution

- Current `menodao` → Rename to `menodao_dev` (keeps all your dev data)
- Create fresh `menodao_prod` → Production only (empty, clean start)

## Setup (5 minutes)

### 1. Run Setup Script

```bash
cd scripts
chmod +x setup-separate-databases.sh
./setup-separate-databases.sh
```

This will:

- Rename `menodao` to `menodao_dev`
- Create fresh `menodao_prod`
- Run migrations on prod

### 2. Update AWS Secrets Manager

**Dev Environment:**

```bash
aws secretsmanager update-secret \
  --secret-id menodao/dev/app \
  --secret-string "$(cat <<EOF
{
  "DATABASE_URL": "postgresql://username:password@host/menodao_dev?sslmode=require",
  "NODE_ENV": "development",
  "JWT_SECRET": "your-dev-jwt-secret"
}
EOF
)" \
  --region us-east-1
```

**Prod Environment:**

```bash
aws secretsmanager update-secret \
  --secret-id menodao/production/app \
  --secret-string "$(cat <<EOF
{
  "DATABASE_URL": "postgresql://username:password@host/menodao_prod?sslmode=require",
  "NODE_ENV": "production",
  "JWT_SECRET": "your-production-jwt-secret"
}
EOF
)" \
  --region us-east-1
```

### 3. Redeploy Services

**Dev:**

```bash
git push origin dev
```

**Prod:**

```bash
git push origin main
```

ECS will automatically pick up new DATABASE_URL from Secrets Manager.

## Validation

The `validate-database.js` script runs before every migration to ensure:

- Dev uses `menodao_dev`
- Prod uses `menodao_prod`
- No cross-contamination

## Result

- ✅ Dev has all your current data in `menodao_dev`
- ✅ Prod has fresh database in `menodao_prod`
- ✅ Complete separation
- ✅ Zero downtime

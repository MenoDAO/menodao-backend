#!/bin/bash

# Simple Database Separation Setup
# Current 'menodao' stays as dev, create fresh 'menodao_prod' for production

set -e

DB_HOST="***REMOVED***"
DB_USER="***REMOVED***"
DB_PORT="5432"

echo "🗄️  Database Separation Setup"
echo "=============================="
echo ""
echo "Strategy:"
echo "  - Current 'menodao' database → Keep as DEV (rename to menodao_dev)"
echo "  - Create fresh 'menodao_prod' → Production only"
echo ""

read -sp "Enter database password: " DB_PASSWORD
echo ""

# Test connection
echo "🔌 Testing connection..."
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER -d postgres -c "SELECT 1;" > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "❌ Connection failed"
    exit 1
fi
echo "✅ Connected"

# Rename current database to menodao_dev
echo ""
echo "📦 Renaming 'menodao' to 'menodao_dev'..."
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER -d postgres <<EOF
ALTER DATABASE menodao RENAME TO menodao_dev;
EOF

if [ $? -eq 0 ]; then
    echo "✅ Renamed to menodao_dev"
else
    echo "⚠️  Database might already be renamed or in use"
fi

# Create fresh prod database
echo ""
echo "📦 Creating fresh 'menodao_prod'..."
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER -d postgres <<EOF
CREATE DATABASE menodao_prod;
GRANT ALL PRIVILEGES ON DATABASE menodao_prod TO $DB_USER;
EOF

if [ $? -eq 0 ]; then
    echo "✅ menodao_prod created"
else
    echo "⚠️  menodao_prod might already exist"
fi

# Run migrations on prod only (dev already has schema)
echo ""
echo "🔄 Running migrations on menodao_prod..."
export DATABASE_URL="postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/menodao_prod?sslmode=require"
npx prisma migrate deploy

if [ $? -eq 0 ]; then
    echo "✅ Prod migrations completed"
else
    echo "❌ Prod migrations failed"
    exit 1
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next: Update AWS Secrets Manager:"
echo "  Dev:  menodao_dev (has your current data)"
echo "  Prod: menodao_prod (fresh, empty)"

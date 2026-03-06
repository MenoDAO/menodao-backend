#!/bin/bash
# Check recent contributions with upgrade metadata
echo "=== Recent Contributions with Upgrade Metadata ==="
psql $DATABASE_URL -c "SELECT id, \"memberId\", amount, status, \"createdAt\", metadata FROM \"Contribution\" WHERE metadata::text LIKE '%isUpgrade%' ORDER BY \"createdAt\" DESC LIMIT 5;"

echo ""
echo "=== Member Subscription Status ==="
# Get the member ID from the most recent upgrade contribution
MEMBER_ID=$(psql $DATABASE_URL -t -c "SELECT \"memberId\" FROM \"Contribution\" WHERE metadata::text LIKE '%isUpgrade%' ORDER BY \"createdAt\" DESC LIMIT 1;" | xargs)

if [ -n "$MEMBER_ID" ]; then
  echo "Member ID: $MEMBER_ID"
  psql $DATABASE_URL -c "SELECT id, \"memberId\", tier, \"monthlyAmount\", \"annualCapLimit\", \"isActive\", \"updatedAt\" FROM \"Subscription\" WHERE \"memberId\" = '$MEMBER_ID';"
fi

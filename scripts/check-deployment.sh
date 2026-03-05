#!/bin/bash

# Script to check if the latest upgrade fix is deployed
# Usage: ./check-deployment.sh

echo "🔍 Checking if upgrade fix is deployed..."
echo ""

# Check if the upgrade processing code exists in the deployed version
if grep -q "Processing upgrade for member" src/payments/payment.service.ts; then
  echo "✅ Upgrade processing code found in source"
else
  echo "❌ Upgrade processing code NOT found in source"
  echo "   The latest code may not be checked out"
  exit 1
fi

# Check the git commit
CURRENT_COMMIT=$(git rev-parse --short HEAD)
echo "📌 Current commit: $CURRENT_COMMIT"

# Check if the fix commits are in the history
if git log --oneline -20 | grep -q "upgrade"; then
  echo "✅ Upgrade-related commits found in recent history:"
  git log --oneline -20 | grep -i "upgrade" | head -5
else
  echo "⚠️  No upgrade-related commits found in recent history"
fi

echo ""
echo "💡 To verify deployment on dev server:"
echo "   1. SSH into dev server"
echo "   2. cd /path/to/menodao-backend"
echo "   3. Run: git log --oneline -5"
echo "   4. Check if commits cf64d9c and 32f021b are present"
echo ""
echo "💡 To check if backend is running latest code:"
echo "   1. Make a test upgrade payment"
echo "   2. Check logs: ./infrastructure/scripts/get-logs.sh dev 10"
echo "   3. Look for: 'Processing upgrade for member'"
echo ""

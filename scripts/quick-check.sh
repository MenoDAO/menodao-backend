#!/bin/bash

# Quick check script to diagnose upgrade issue
# Usage: ./quick-check.sh [phone_number]

PHONE=${1:-"+254712345678"}

echo "🔍 Quick Upgrade Issue Check"
echo "=============================="
echo ""

echo "📱 Checking member: $PHONE"
echo ""

# Check if we can connect to database
echo "1️⃣  Testing database connection..."
if npx ts-node -e "const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient(); p.\$connect().then(() => { console.log('✅ Database connected'); process.exit(0); }).catch(e => { console.log('❌ Database connection failed:', e.message); process.exit(1); });" 2>/dev/null; then
  echo ""
else
  echo "❌ Cannot connect to database. Are you on the dev server?"
  echo "   Run this script on the dev server where the database is accessible."
  exit 1
fi

# Check current subscription
echo "2️⃣  Checking current subscription..."
npx ts-node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.member.findUnique({
  where: { phoneNumber: '$PHONE' },
  include: { subscription: true }
}).then(m => {
  if (!m) {
    console.log('❌ Member not found');
    process.exit(1);
  }
  console.log('✅ Member found:', m.id);
  console.log('   Current tier:', m.subscription?.tier || 'NONE');
  console.log('   Is active:', m.subscription?.isActive || false);
  process.exit(0);
}).catch(e => {
  console.log('❌ Error:', e.message);
  process.exit(1);
});
" 2>/dev/null
echo ""

# Check for upgrade contributions
echo "3️⃣  Checking for upgrade contributions..."
npx ts-node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.contribution.findMany({
  where: {
    member: { phoneNumber: '$PHONE' },
    status: 'COMPLETED'
  },
  orderBy: { createdAt: 'desc' },
  take: 5
}).then(contributions => {
  const upgrades = contributions.filter(c => c.metadata?.isUpgrade === true);
  if (upgrades.length === 0) {
    console.log('ℹ️  No upgrade contributions found');
  } else {
    console.log('🔄 Found', upgrades.length, 'upgrade contribution(s):');
    upgrades.forEach((c, i) => {
      console.log('   ', i+1, '- Target:', c.metadata.newTier, '| Status:', c.status, '| Date:', c.createdAt.toISOString().split('T')[0]);
    });
  }
  process.exit(0);
}).catch(e => {
  console.log('❌ Error:', e.message);
  process.exit(1);
});
" 2>/dev/null
echo ""

# Check git status
echo "4️⃣  Checking deployed code version..."
CURRENT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null)
if [ -n "$CURRENT_COMMIT" ]; then
  echo "   Current commit: $CURRENT_COMMIT"
  
  # Check if upgrade commits are present
  if git log --oneline -20 | grep -q "cf64d9c\|32f021b"; then
    echo "   ✅ Upgrade fix commits found"
  else
    echo "   ⚠️  Upgrade fix commits NOT found"
    echo "   Expected commits: cf64d9c, 32f021b"
  fi
else
  echo "   ⚠️  Not a git repository"
fi
echo ""

echo "=============================="
echo "💡 Next Steps:"
echo ""
echo "   To see detailed diagnosis:"
echo "   npx ts-node scripts/diagnose-upgrade-issue.ts \"$PHONE\""
echo ""
echo "   To fix the user's subscription:"
echo "   npx ts-node scripts/fix-user-upgrade.ts \"$PHONE\" GOLD"
echo ""
echo "   To check backend logs:"
echo "   ./infrastructure/scripts/get-logs.sh dev 60 | grep -i upgrade"
echo ""

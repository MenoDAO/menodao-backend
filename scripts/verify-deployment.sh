#!/bin/bash

echo "=== MenoDAO Backend Deployment Verification ==="
echo ""
echo "Checking ECS Service Status..."
aws ecs describe-services \
  --cluster menodao \
  --services menodao-api-dev \
  --region us-east-1 \
  --query 'services[0].{Status:status,DesiredCount:desiredCount,RunningCount:runningCount,TaskDefinition:taskDefinitionArn}' \
  --output table

echo ""
echo "Checking Running Tasks..."
aws ecs list-tasks \
  --cluster menodao \
  --service-name menodao-api-dev \
  --region us-east-1 \
  --query 'taskArns[0]' \
  --output text | xargs -I {} aws ecs describe-tasks \
  --cluster menodao \
  --tasks {} \
  --region us-east-1 \
  --query 'tasks[0].{TaskArn:taskArn,Status:lastStatus,Health:healthStatus,StartedAt:startedAt}' \
  --output table

echo ""
echo "Checking API Health..."
curl -s https://dev-api.menodao.org/health | jq '.'

echo ""
echo "✅ Deployment verification complete!"
echo ""
echo "Next steps:"
echo "1. Test the upgrade flow with a real payment"
echo "2. Monitor logs: aws logs tail /ecs/menodao-api --since 5m --region us-east-1"
echo "3. If upgrade fails, check metadata: npx ts-node scripts/check-user-metadata.ts <phone>"
echo "4. If needed, manually fix: npx ts-node scripts/fix-user-upgrade.ts <phone> <tier>"

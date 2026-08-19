#!/usr/bin/env bash
# Wait for an ECS one-off Prisma migrate task to stop, then fail if it did not exit 0.
set -euo pipefail

CLUSTER="${1:?cluster name required}"
TASK_ARN="${2:?task ARN required}"

if [[ -z "$TASK_ARN" || "$TASK_ARN" == "None" ]]; then
  echo "Migration task did not start"
  exit 1
fi

echo "Waiting for migration task to stop: $TASK_ARN"
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK_ARN"

EXIT_CODE="$(aws ecs describe-tasks \
  --cluster "$CLUSTER" \
  --tasks "$TASK_ARN" \
  --query 'tasks[0].containers[0].exitCode' \
  --output text)"
REASON="$(aws ecs describe-tasks \
  --cluster "$CLUSTER" \
  --tasks "$TASK_ARN" \
  --query 'tasks[0].containers[0].reason' \
  --output text)"

echo "Migration exit code: ${EXIT_CODE:-unknown}"
if [[ -n "$REASON" && "$REASON" != "None" ]]; then
  echo "Container reason: $REASON"
fi

if [[ "$EXIT_CODE" != "0" ]]; then
  echo "Prisma migrate deploy failed"
  exit 1
fi

echo "Migration completed successfully"

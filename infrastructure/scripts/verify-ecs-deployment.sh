#!/usr/bin/env bash
# Fail if ECS reported stability after rolling back to an older image.
set -euo pipefail

CLUSTER="${1:?cluster name required}"
SERVICE="${2:?service name required}"
EXPECTED_SHA="${3:?git sha required}"

SERVICE_TD=$(aws ecs describe-services \
  --cluster "$CLUSTER" \
  --services "$SERVICE" \
  --query 'services[0].taskDefinition' \
  --output text)

IMAGE=$(aws ecs describe-task-definition --task-definition "$SERVICE_TD" \
  --query 'taskDefinition.containerDefinitions[0].image' \
  --output text)

echo "Running task definition: $SERVICE_TD"
echo "Running image: $IMAGE"
echo "Expected SHA: $EXPECTED_SHA"

if [[ "$IMAGE" != *"$EXPECTED_SHA"* ]]; then
  echo "Deploy did not stay on the new image (likely circuit-breaker rollback)."
  aws ecs describe-services \
    --cluster "$CLUSTER" \
    --services "$SERVICE" \
    --query 'services[0].events[0:10].message' \
    --output text
  exit 1
fi

echo "Service is running the expected image"

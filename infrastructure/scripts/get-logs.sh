#!/bin/bash

# Script to retrieve CloudWatch logs from ECS tasks
# Usage: ./get-logs.sh [dev|production] [minutes]

set -e

ENVIRONMENT=${1:-dev}
MINUTES=${2:-30}

# Configuration
# Note: Log group is /ecs/menodao-api for both dev and production
# The environment is distinguished by the log stream prefix (dev/ or prod/)
LOG_GROUP="/ecs/menodao-api"
REGION="us-east-1"

echo "🔍 Retrieving logs from ${ENVIRONMENT} environment..."
echo "📊 Log Group: ${LOG_GROUP}"
echo "⏰ Last ${MINUTES} minutes"
echo ""

# Calculate start time (X minutes ago)
START_TIME=$(($(date +%s) - (MINUTES * 60)))
START_TIME_MS=$((START_TIME * 1000))

# Get log streams (most recent first)
# Filter by environment prefix (dev/ or prod/)
echo "📋 Getting log streams..."
LOG_STREAMS=$(aws logs describe-log-streams \
  --log-group-name "${LOG_GROUP}" \
  --order-by LastEventTime \
  --descending \
  --max-items 5 \
  --region "${REGION}" \
  --query "logStreams[?starts_with(logStreamName, '${ENVIRONMENT}/')].logStreamName" \
  --output text)

if [ -z "$LOG_STREAMS" ]; then
  echo "❌ No log streams found in ${LOG_GROUP}"
  echo "   Make sure the service is running and has generated logs."
  exit 1
fi

echo "✅ Found log streams"
echo ""

# Get logs from each stream
for STREAM in $LOG_STREAMS; do
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📝 Stream: ${STREAM}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  aws logs get-log-events \
    --log-group-name "${LOG_GROUP}" \
    --log-stream-name "${STREAM}" \
    --start-time "${START_TIME_MS}" \
    --region "${REGION}" \
    --query 'events[*].[timestamp,message]' \
    --output text | while IFS=$'\t' read -r timestamp message; do
      # Convert timestamp to readable format
      readable_time=$(date -d "@$((timestamp / 1000))" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -r "$((timestamp / 1000))" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "$timestamp")
      echo "[${readable_time}] ${message}"
    done
  
  echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Log retrieval complete"
echo ""
echo "💡 Tips:"
echo "   - To see more logs: ./get-logs.sh ${ENVIRONMENT} 60"
echo "   - To filter logs: ./get-logs.sh ${ENVIRONMENT} 30 | grep 'AdminAuthGuard'"
echo "   - To see production logs: ./get-logs.sh production 30"

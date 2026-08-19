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

aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" --output json | python3 -c '
import json, sys
payload = json.load(sys.stdin)
task = payload["tasks"][0]
container = (task.get("containers") or [{}])[0]
stop_code = task.get("stopCode")
stopped_reason = task.get("stoppedReason")
exit_code = container.get("exitCode")
reason = container.get("reason")
print(f"stopCode: {stop_code}")
print(f"stoppedReason: {stopped_reason}")
print(f"container exit: {exit_code}")
if reason:
    print(f"container reason: {reason}")
ok = stop_code != "TaskFailedToStart" and exit_code in (0, "0")
sys.exit(0 if ok else 1)
'

echo "Migration completed successfully"

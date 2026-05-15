#!/usr/bin/env bash
# Sync Turnstile CAPTCHA config to AWS Secrets Manager and patch an ECS task definition JSON.
#
# Usage:
#   TURNSTILE_SECRET_KEY=0x... ./infrastructure/scripts/sync-captcha-to-aws.sh dev [task-definition.json]
#   TURNSTILE_SECRET_KEY=0x... ./infrastructure/scripts/sync-captcha-to-aws.sh prod [task-definition.json]
#
# Requires: aws CLI, jq

set -euo pipefail

ENV="${1:-dev}"
TASK_DEF_FILE="${2:-}"

if [[ -z "${TURNSTILE_SECRET_KEY:-}" ]]; then
  echo "❌ TURNSTILE_SECRET_KEY is not set"
  exit 1
fi

REGION="${AWS_REGION:-us-east-1}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"

if [[ "$ENV" == "prod" || "$ENV" == "production" ]]; then
  SECRET_ID="menodao/api/secrets"
else
  SECRET_ID="menodao/api-stg/secrets"
fi

SECRETS_ARN="arn:aws:secretsmanager:${REGION}:${ACCOUNT_ID}:secret:${SECRET_ID}"

echo "🔐 Syncing Turnstile secret to ${SECRET_ID}..."

CURRENT="$(aws secretsmanager get-secret-value \
  --secret-id "$SECRET_ID" \
  --region "$REGION" \
  --query SecretString \
  --output text)"

UPDATED="$(echo "$CURRENT" | jq \
  --arg key "$TURNSTILE_SECRET_KEY" \
  '. + {TURNSTILE_SECRET_KEY: $key, CAPTCHA_DISABLED: "false"}')"

aws secretsmanager put-secret-value \
  --secret-id "$SECRET_ID" \
  --region "$REGION" \
  --secret-string "$UPDATED" >/dev/null

echo "✅ Secrets Manager updated"

if [[ -n "$TASK_DEF_FILE" && -f "$TASK_DEF_FILE" ]]; then
  echo "📝 Patching task definition: $TASK_DEF_FILE"

  VALUE_FROM="${SECRETS_ARN}:TURNSTILE_SECRET_KEY::"
  TMP="$(mktemp)"
  jq --arg vf "$VALUE_FROM" --arg cn "menodao-backend" '
    .containerDefinitions |= map(
      if .name == $cn then
        .secrets = (
          (.secrets // [])
          | if any(.name == "TURNSTILE_SECRET_KEY") then .
            else . + [{name: "TURNSTILE_SECRET_KEY", valueFrom: $vf}]
            end
        )
        | .environment = (
          (.environment // [])
          | if any(.name == "CAPTCHA_DISABLED") then .
            else . + [{name: "CAPTCHA_DISABLED", value: "false"}]
            end
        )
      else .
      end
    )
  ' "$TASK_DEF_FILE" > "$TMP"
  mv "$TMP" "$TASK_DEF_FILE"
  echo "✅ Task definition patched with TURNSTILE_SECRET_KEY mapping"
fi

#!/usr/bin/env bash
# Sync Turnstile CAPTCHA config to AWS and patch an ECS task definition JSON.
#
# Tries Secrets Manager first; if PutSecretValue is denied, injects the key
# directly into the task definition environment (still works for CAPTCHA).
#
# Usage:
#   TURNSTILE_SECRET_KEY=0x... ./infrastructure/scripts/sync-captcha-to-aws.sh dev [task-definition.json]
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
USE_SECRETS_MANAGER=false

echo "🔐 Syncing Turnstile secret to ${SECRET_ID}..."

if CURRENT="$(aws secretsmanager get-secret-value \
  --secret-id "$SECRET_ID" \
  --region "$REGION" \
  --query SecretString \
  --output text 2>/dev/null)"; then

  UPDATED="$(echo "$CURRENT" | jq \
    --arg key "$TURNSTILE_SECRET_KEY" \
    '. + {TURNSTILE_SECRET_KEY: $key, CAPTCHA_DISABLED: "false"}')"

  if aws secretsmanager put-secret-value \
    --secret-id "$SECRET_ID" \
    --region "$REGION" \
    --secret-string "$UPDATED" >/dev/null 2>&1; then
    echo "✅ Secrets Manager updated"
    USE_SECRETS_MANAGER=true
  else
    echo "⚠️  Secrets Manager PutSecretValue denied — will inject key via task definition env"
  fi
else
  echo "⚠️  Could not read ${SECRET_ID} — will inject key via task definition env"
fi

if [[ -n "$TASK_DEF_FILE" && -f "$TASK_DEF_FILE" ]]; then
  echo "📝 Patching task definition: $TASK_DEF_FILE"

  TMP="$(mktemp)"
  if [[ "$USE_SECRETS_MANAGER" == "true" ]]; then
    VALUE_FROM="${SECRETS_ARN}:TURNSTILE_SECRET_KEY::"
    jq --arg vf "$VALUE_FROM" --arg cn "menodao-backend" '
      .containerDefinitions |= map(
        if .name == $cn then
          .secrets = (
            (.secrets // [])
            | map(select(.name != "TURNSTILE_SECRET_KEY"))
            | . + [{name: "TURNSTILE_SECRET_KEY", valueFrom: $vf}]
          )
          | .environment = (
            (.environment // [])
            | map(select(.name != "CAPTCHA_DISABLED"))
            | . + [{name: "CAPTCHA_DISABLED", value: "false"}]
          )
        else . end
      )
    ' "$TASK_DEF_FILE" > "$TMP"
  else
    jq --arg key "$TURNSTILE_SECRET_KEY" --arg cn "menodao-backend" '
      .containerDefinitions |= map(
        if .name == $cn then
          .environment = (
            (.environment // [])
            | map(select(.name != "TURNSTILE_SECRET_KEY" and .name != "CAPTCHA_DISABLED"))
            | . + [
                {name: "TURNSTILE_SECRET_KEY", value: $key},
                {name: "CAPTCHA_DISABLED", value: "false"}
              ]
          )
        else . end
      )
    ' "$TASK_DEF_FILE" > "$TMP"
  fi
  mv "$TMP" "$TASK_DEF_FILE"
  echo "✅ Task definition patched for CAPTCHA"
fi

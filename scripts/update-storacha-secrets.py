#!/usr/bin/env python3
"""Push Storacha credentials into AWS Secrets Manager.

Reads credentials from the environment. Never hardcode keys in this file.

Required env:
  STORACHA_PROOF
  STORACHA_PRIVATE_KEY
  STORACHA_SPACE_DID

Usage:
  STORACHA_PROOF=... STORACHA_PRIVATE_KEY=... STORACHA_SPACE_DID=... \\
    python3 scripts/update-storacha-secrets.py
"""
import json
import os
import subprocess
import sys

REQUIRED = ("STORACHA_PROOF", "STORACHA_PRIVATE_KEY", "STORACHA_SPACE_DID")
SECRET_IDS = ["menodao/api-stg/secrets", "menodao/api/secrets"]

missing = [name for name in REQUIRED if not os.environ.get(name)]
if missing:
    print(f"Missing required env vars: {', '.join(missing)}", file=sys.stderr)
    sys.exit(1)

updates = {name: os.environ[name] for name in REQUIRED}

for secret_id in SECRET_IDS:
    result = subprocess.run(
        [
            "aws",
            "secretsmanager",
            "get-secret-value",
            "--secret-id",
            secret_id,
            "--query",
            "SecretString",
            "--output",
            "text",
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"Failed to get {secret_id}: {result.stderr}")
        continue

    secrets = json.loads(result.stdout)
    secrets.update(updates)

    put = subprocess.run(
        [
            "aws",
            "secretsmanager",
            "put-secret-value",
            "--secret-id",
            secret_id,
            "--secret-string",
            json.dumps(secrets),
        ],
        capture_output=True,
        text=True,
    )
    if put.returncode == 0:
        payload = json.loads(put.stdout)
        print(f"Updated {payload['Name']} | Version: {payload['VersionId'][:8]}")
    else:
        print(f"Failed to update {secret_id}: {put.stderr}")

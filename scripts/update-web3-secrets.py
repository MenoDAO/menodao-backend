#!/usr/bin/env python3
"""
Update AWS Secrets Manager with Web3/ClaimVault settings.

Public contract metadata may use the documented Base Sepolia defaults.
AGENT_SIGNER_PRIVATE_KEY must come from the environment — never commit it.

Usage:
    AGENT_SIGNER_PRIVATE_KEY=0x... python3 scripts/update-web3-secrets.py

Requires AWS CLI configured with appropriate permissions.
"""
import json
import os
import subprocess
import sys

if not os.environ.get("AGENT_SIGNER_PRIVATE_KEY"):
    print("Missing required env var: AGENT_SIGNER_PRIVATE_KEY", file=sys.stderr)
    sys.exit(1)

# Public on-chain fields. Override with env when redeploying.
NEW_SECRETS = {
    "CLAIM_VAULT_CONTRACT_ADDRESS": os.environ.get(
        "CLAIM_VAULT_CONTRACT_ADDRESS",
        "0x22F360D9C3F84d5C6aC8dc450Dc6582a394dA002",
    ),
    "CLAIM_VAULT_CHAIN_ID": os.environ.get("CLAIM_VAULT_CHAIN_ID", "84532"),
    "BASE_SEPOLIA_RPC": os.environ.get(
        "BASE_SEPOLIA_RPC",
        "https://sepolia.base.org",
    ),
    "AGENT_SIGNER_PRIVATE_KEY": os.environ["AGENT_SIGNER_PRIVATE_KEY"],
    "AGENT_SIGNER_ADDRESS": os.environ.get(
        "AGENT_SIGNER_ADDRESS",
        "0x88f8E8d1faC4809B662DFD526456DB7FfdA69465",
    ),
}

SECRET_IDS = ["menodao/api-stg/secrets", "menodao/api/secrets"]

for secret_id in SECRET_IDS:
    print(f"\nUpdating {secret_id}...")

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
        print(f"  Failed to get {secret_id}: {result.stderr.strip()}")
        continue

    current = json.loads(result.stdout)
    current.update(NEW_SECRETS)

    put = subprocess.run(
        [
            "aws",
            "secretsmanager",
            "put-secret-value",
            "--secret-id",
            secret_id,
            "--secret-string",
            json.dumps(current),
        ],
        capture_output=True,
        text=True,
    )

    if put.returncode == 0:
        payload = json.loads(put.stdout)
        print(f"  Updated {payload['Name']} | Version: {payload['VersionId'][:8]}")
        print(f"     Keys: {', '.join(NEW_SECRETS.keys())}")
    else:
        print(f"  Failed to update {secret_id}: {put.stderr.strip()}")

#!/usr/bin/env python3
"""
Update AWS Secrets Manager with new Web3/ClaimVault secrets.
Adds the 5 new env vars required for EIP-712 signed payouts via MenoDAOClaimVault on Base Sepolia.

Usage:
    python3 scripts/update-web3-secrets.py

Requires AWS CLI configured with appropriate permissions.
"""
import json
import subprocess

# New secrets to add — MenoDAOClaimVault on Base Sepolia
NEW_SECRETS = {
    "CLAIM_VAULT_CONTRACT_ADDRESS": "0x22F360D9C3F84d5C6aC8dc450Dc6582a394dA002",
    "CLAIM_VAULT_CHAIN_ID": "84532",
    "BASE_SEPOLIA_RPC": "https://sepolia.base.org",
    "AGENT_SIGNER_PRIVATE_KEY": "0x16db3f7454239acfd92be55878a5a9b5b47f0116adcc014987058583e88ab456",
    "AGENT_SIGNER_ADDRESS": "0x88f8E8d1faC4809B662DFD526456DB7FfdA69465",
}

# Update both staging and production secrets
SECRET_IDS = ["menodao/api-stg/secrets", "menodao/api/secrets"]

for secret_id in SECRET_IDS:
    print(f"\n📦 Updating {secret_id}...")

    # Fetch current secret
    result = subprocess.run(
        [
            "aws", "secretsmanager", "get-secret-value",
            "--secret-id", secret_id,
            "--query", "SecretString",
            "--output", "text",
        ],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        print(f"  ❌ Failed to get {secret_id}: {result.stderr.strip()}")
        continue

    current = json.loads(result.stdout)

    # Merge new secrets in
    current.update(NEW_SECRETS)

    # Push updated secret
    put = subprocess.run(
        [
            "aws", "secretsmanager", "put-secret-value",
            "--secret-id", secret_id,
            "--secret-string", json.dumps(current),
        ],
        capture_output=True,
        text=True,
    )

    if put.returncode == 0:
        r = json.loads(put.stdout)
        print(f"  ✅ Updated {r['Name']} | Version: {r['VersionId'][:8]}")
        print(f"     Added: {', '.join(NEW_SECRETS.keys())}")
    else:
        print(f"  ❌ Failed to update {secret_id}: {put.stderr.strip()}")

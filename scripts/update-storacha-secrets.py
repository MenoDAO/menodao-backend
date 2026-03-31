#!/usr/bin/env python3
import json, subprocess

STORACHA_PROOF = "OqJlcm9vdHOB2CpYJQABcRIg0b874DolXvXbBrYfEj3HUS9oMAgm49MMB/Xv8yRHoHFndmVyc2lvbgHEAgFxEiBCQDx14pxBIZRhH0cl7j/+dIjFD7mt5sj2aRPN3TvWXKhhc1hE7aEDQM70rQRJn3JF09H8rXpT81Rt+aBznAwWM0Tz/TL+1VyEd7mqbLJbpsFWTrjvL/KWKKY5JGn03O5lgyG7YYxIvwFhdmUwLjkuMWNhdHSBomNjYW5hKmR3aXRoeDhkaWQ6a2V5Ono2TWt1dWdjV3A4d0Z1aDZlOVRzUjhlV0dzdWtZa2ZhdWdTRzlMQnB5ZW50a3Y3Z2NhdWRYHp0abWFpbHRvOmdtYWlsLmNvbTptZW5vZGFvLm9yZ2NleHD2Y2ZjdIGhZXNwYWNlomRuYW1lZ21lbm9kYW9mYWNjZXNzoWR0eXBlZnB1YmxpY2Npc3NYIu0B5aQvBEiHvqf21Dty7U6eS2AzWdMLSsEr/A1O5zBuiD9jcHJmgMECAXESIP4wDSkRnnaV4pOAc+PKCCPA4CIxpqMxW53WnUiF2HsBqGFzRICgAwBhdmUwLjkuMWNhdHSBomNjYW5hKmR3aXRoZnVjYW46KmNhdWRYIu0BNfvYf0WWGtmzBMV29x3FI256vIEM7pT9eHfCkUAgOfFjZXhw9mNmY3SBom5hY2Nlc3MvY29uZmlybdgqWCUAAXESIK7GHYsjKQhODhqdbvBJIJum4OCNChr5Ll+ypEDaU7QPbmFjY2Vzcy9yZXF1ZXN02CpYJQABcRIgzWFWbDGKLW15U4rhqB93QO8wTv+z6eykCJ6AEW6x7WVjaXNzWB6dGm1haWx0bzpnbWFpbC5jb206bWVub2Rhby5vcmdjcHJmgdgqWCUAAXESIEJAPHXinEEhlGEfRyXuP/50iMUPua3myPZpE83dO9ZcpwMBcRIgElWEb2VsO+P1x0R2fo0PwB/uiSOd4KKOcP822wM4NNuoYXNYRO2hA0DSdAowOQrsN96+u5DCD7+F4HrOUWhg381h5+p2x03QQ3TLI58h9d0r6+e8C0DygI6DhAmFJ8prRYZMRmRW61sHYXZlMC45LjFjYXR0gaNibmKhZXByb29m2CpYJQABcRIg/jANKRGedpXik4Bz48oII8DgIjGmozFbndadSIXYewFjY2Fua3VjYW4vYXR0ZXN0ZHdpdGh4G2RpZDp3ZWI6dXAuc3RvcmFjaGEubmV0d29ya2NhdWRYIu0BNfvYf0WWGtmzBMV29x3FI256vIEM7pT9eHfCkUAgOfFjZXhw9mNmY3SBom5hY2Nlc3MvY29uZmlybdgqWCUAAXESIK7GHYsjKQhODhqdbvBJIJum4OCNChr5Ll+ypEDaU7QPbmFjY2Vzcy9yZXF1ZXN02CpYJQABcRIgzWFWbDGKLW15U4rhqB93QO8wTv+z6eykCJ6AEW6x7WVjaXNzWBmdGndlYjp1cC5zdG9yYWNoYS5uZXR3b3JrY3ByZoDxAwFxEiCKhwp+Foi+fDin0yoCWR+tGB53g3O8c5tnnmZZcs1hcKhhc1hE7aEDQFIDwmrI2wlHJVMkQF9l2fQ9aPH0znYb7di1O9ezHyxxQH/sptUKOsOUg7hjQOsnAJ/VBsydPidcVElTRCR7uAVhdmUwLjkuMWNhdHSComNjYW5pc3RvcmUvYWRkZHdpdGh4OGRpZDprZXk6ejZNa3V1Z2NXcDh3RnVoNmU5VHNSOGVXR3N1a1lrZmF1Z1NHOUxCcHllbnRrdjdnomNjYW5qdXBsb2FkL2FkZGR3aXRoeDhkaWQ6a2V5Ono2TWt1dWdjV3A4d0Z1aDZlOVRzUjhlV0dzdWtZa2ZhdWdTRzlMQnB5ZW50a3Y3Z2NhdWRYIu0Bl7rFzJyZGhHQk7KtoePiEn9HgjoZYiJJo2sdnMZgsyFjZXhw9mNmY3SBoWVzcGFjZaJkbmFtZWdtZW5vZGFvZmFjY2Vzc6FkdHlwZWZwdWJsaWNjaXNzWCLtATX72H9FlhrZswTFdvcdxSNueryBDO6U/Xh3wpFAIDnxY3ByZoLYKlglAAFxEiD+MA0pEZ52leKTgHPjyggjwOAiMaajMVud1p1Ihdh7AdgqWCUAAXESIBJVhG9lbDvj9cdEdn6ND8Af7okjneCijnD/NtsDODTbWQFxEiDRvzvgOiVe9dsGth8SPcdRL2gwCCbj0wwH9e/zJEegcaFqdWNhbkAwLjkuMdgqWCUAAXESIIqHCn4WiL58OKfTKgJZH60YHneDc7xzm2eeZllyzWFw"
STORACHA_PRIVATE_KEY = "MgCbZaIMtSlUcrQEIoNC2x/sXdTihJWWduWBu0dIQhRbRz+0Bl7rFzJyZGhHQk7KtoePiEn9HgjoZYiJJo2sdnMZgsyE="
STORACHA_SPACE_DID = "did:key:z6MkuugcWp8wFuh6e9TsR8eWGsukYkfaugSG9LBpyentkv7g"

for secret_id in ["menodao/api-stg/secrets", "menodao/api/secrets"]:
    result = subprocess.run(
        ["aws", "secretsmanager", "get-secret-value", "--secret-id", secret_id,
         "--query", "SecretString", "--output", "text"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"Failed to get {secret_id}: {result.stderr}")
        continue

    s = json.loads(result.stdout)
    s["STORACHA_PROOF"] = STORACHA_PROOF
    s["STORACHA_PRIVATE_KEY"] = STORACHA_PRIVATE_KEY
    s["STORACHA_SPACE_DID"] = STORACHA_SPACE_DID

    put = subprocess.run(
        ["aws", "secretsmanager", "put-secret-value",
         "--secret-id", secret_id,
         "--secret-string", json.dumps(s)],
        capture_output=True, text=True
    )
    if put.returncode == 0:
        r = json.loads(put.stdout)
        print(f"Updated {r['Name']} | Version: {r['VersionId'][:8]}")
    else:
        print(f"Failed to update {secret_id}: {put.stderr}")

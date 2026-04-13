# Requirements Document

## Introduction

This feature upgrades the MenoDAO blockchain payout system from a direct owner-controlled transfer model to a cryptographically verifiable intent model. After AI verification, the backend agent signs a structured EIP-712 typed-data claim. A new smart contract (`MenoDAOPaymaster`) verifies the signature on-chain, enforces payout rules, and executes the transfer — replacing the direct `approveAndPay` call. The backend signer wallet holds no funds; a separate treasury wallet funds the contract. This creates an auditable, tamper-evident chain from Filecoin evidence (CIDs) through AI verification to on-chain payout.

## Glossary

- **EIP712SignerService**: NestJS service responsible for constructing and signing EIP-712 typed-data claim objects using the agent signer wallet.
- **SignedClaim**: The structured data object containing claimId, clinic address, payout amount, resultHash, timestamp, beforeCID, and afterCID, together with its EIP-712 signature.
- **MenoDAOPaymaster**: New Solidity smart contract that accepts a SignedClaim, verifies the EIP-712 signature, enforces payout rules, and executes the transfer to the clinic.
- **Agent_Signer**: The backend wallet that signs claims. It does NOT hold funds.
- **Treasury**: A separate wallet that funds the MenoDAOPaymaster contract. Only the contract can spend these funds.
- **resultHash**: A `keccak256` hash of the serialised AI verification output (verified, confidence, reason) bound to the claim.
- **claimId**: A unique identifier for each payout claim, derived from the on-chain case ID and visit ID, used to prevent replay attacks.
- **CaseProcessorService**: Existing NestJS service that orchestrates the full pipeline (upload → AI verify → on-chain submit → payout → Hypercert).
- **BlockchainCaseService**: Existing NestJS service that interacts with the MenoDAOCases contract.
- **MenoDAOCases**: Existing Solidity contract for case submission (submitCase). Its submitCase function is still used; only the payout step changes.
- **Filecoin_Calibration**: The Filecoin Calibration testnet (chainId 314159), the target deployment network.

---

## Requirements

### Requirement 1: EIP-712 Claim Construction

**User Story:** As the MenoDAO platform, I want the backend to construct a structured, typed claim object after AI verification, so that every payout intent is deterministically bound to its evidence and verifiable by anyone with the signer's public key.

#### Acceptance Criteria

1. THE EIP712SignerService SHALL define an EIP-712 domain with name `"MenoDAOPaymaster"`, version `"1"`, and the deployed MenoDAOPaymaster contract address as `verifyingContract`.
2. THE EIP712SignerService SHALL define a `PayoutClaim` type with fields: `claimId` (bytes32), `clinic` (address), `amount` (uint256), `resultHash` (bytes32), `timestamp` (uint256), `beforeCID` (string), `afterCID` (string).
3. WHEN the AI verifier returns a result with `verified = true`, THE EIP712SignerService SHALL compute `resultHash` as the `keccak256` hash of the ABI-encoded tuple `(verified: bool, confidence: uint256 scaled to 1e18, reason: string)`.
4. WHEN constructing a claim, THE EIP712SignerService SHALL set `claimId` to the `keccak256` hash of the ABI-encoded tuple `(caseOnChainId: uint256, visitId: string)`.
5. WHEN constructing a claim, THE EIP712SignerService SHALL set `timestamp` to the Unix timestamp at the moment of signing, obtained from the system clock.
6. THE EIP712SignerService SHALL sign the PayoutClaim using ethers.js v6 `signTypedData` with the Agent_Signer private key loaded from the `AGENT_SIGNER_PRIVATE_KEY` environment variable.
7. THE EIP712SignerService SHALL return the complete SignedClaim object including the 65-byte ECDSA signature.

---

### Requirement 2: MenoDAOPaymaster Smart Contract

**User Story:** As the MenoDAO platform, I want a smart contract that enforces payout rules and verifies the agent's signature before releasing funds, so that no payout can occur without a valid, untampered signed claim from the designated agent.

#### Acceptance Criteria

1. THE MenoDAOPaymaster SHALL verify that the EIP-712 signature on a submitted claim recovers to the configured `agentSigner` address; IF the recovered address does not match, THEN THE MenoDAOPaymaster SHALL revert with `"Invalid signer"`.
2. THE MenoDAOPaymaster SHALL maintain a mapping of processed `claimId` values; IF a claim with an already-processed `claimId` is submitted, THEN THE MenoDAOPaymaster SHALL revert with `"Claim already processed"`.
3. THE MenoDAOPaymaster SHALL maintain a whitelist of approved clinic addresses set by the contract owner; IF the `clinic` address in the claim is not on the whitelist, THEN THE MenoDAOPaymaster SHALL revert with `"Clinic not whitelisted"`.
4. THE MenoDAOPaymaster SHALL enforce a maximum payout per claim of `0.01 ether`; IF the `amount` in the claim exceeds this limit, THEN THE MenoDAOPaymaster SHALL revert with `"Amount exceeds max payout"`.
5. WHEN all validations pass, THE MenoDAOPaymaster SHALL transfer the claim's `amount` in wei to the `clinic` address.
6. WHEN a claim is validated, THE MenoDAOPaymaster SHALL emit `ClaimValidated(bytes32 indexed claimId, bytes32 resultHash)`.
7. WHEN a payout is executed, THE MenoDAOPaymaster SHALL emit `PayoutExecuted(bytes32 indexed claimId, address indexed recipient, uint256 amount)`.
8. THE MenoDAOPaymaster SHALL expose an `addClinic(address)` function callable only by the contract owner to add addresses to the whitelist.
9. THE MenoDAOPaymaster SHALL expose a `removeClinic(address)` function callable only by the contract owner to remove addresses from the whitelist.
10. THE MenoDAOPaymaster SHALL accept native token deposits via a `receive()` function to allow the Treasury to fund it.
11. IF the contract balance is less than the claim amount at execution time, THEN THE MenoDAOPaymaster SHALL revert with `"Insufficient contract balance"`.

---

### Requirement 3: Backend Payout Route via MenoDAOPaymaster

**User Story:** As the MenoDAO platform, I want the CaseProcessorService to sign a claim and submit it to MenoDAOPaymaster instead of calling approveAndPay directly, so that all payouts are routed through the verifiable contract and the signer wallet never holds funds.

#### Acceptance Criteria

1. WHEN the AI verifier returns `verified = true` and the case has been submitted on-chain, THE CaseProcessorService SHALL call EIP712SignerService to produce a SignedClaim before initiating any payout.
2. THE CaseProcessorService SHALL pass the SignedClaim to a new `submitSignedClaim` method on BlockchainCaseService, which calls `MenoDAOPaymaster.executePayout(claim, signature)`.
3. THE CaseProcessorService SHALL NOT call `approveAndPay` on MenoDAOCases after this feature is deployed.
4. WHEN `executePayout` succeeds, THE CaseProcessorService SHALL persist the returned transaction hash as `payoutTxHash` on the Visit record.
5. IF `executePayout` reverts or throws, THE CaseProcessorService SHALL log the error and set `web3VerificationStatus` to `"REJECTED"` on the Visit record.
6. THE BlockchainCaseService SHALL load the MenoDAOPaymaster contract address from the `PAYMASTER_CONTRACT_ADDRESS` environment variable.
7. THE BlockchainCaseService SHALL use a separate provider/wallet instance for the Paymaster contract, using the `AGENT_SIGNER_PRIVATE_KEY` environment variable (the signer, not the deployer key).

---

### Requirement 4: Role Separation — Signer vs Treasury

**User Story:** As the MenoDAO platform operator, I want the signing key and the treasury funds to be held in separate wallets, so that a compromise of the signing key does not expose funds.

#### Acceptance Criteria

1. THE Agent_Signer wallet SHALL only be used to sign EIP-712 claims; it SHALL NOT be the source of payout funds.
2. THE Treasury wallet SHALL fund the MenoDAOPaymaster contract by sending native tokens directly to the contract address.
3. THE MenoDAOPaymaster SHALL only allow fund withdrawal by the contract owner via an explicit `withdraw()` function.
4. THE deploy script SHALL accept separate `DEPLOYER_PRIVATE_KEY` (contract owner / treasury controller) and `AGENT_SIGNER_ADDRESS` (read-only, set at deploy time) as configuration inputs.

---

### Requirement 5: Filecoin CID Linkage in On-Chain Events

**User Story:** As an auditor or verifier, I want the on-chain events to reference the Filecoin CIDs of the before and after images, so that the evidence chain from treatment images to payout is publicly verifiable.

#### Acceptance Criteria

1. THE EIP712SignerService SHALL include `beforeCID` and `afterCID` as fields in the signed PayoutClaim struct.
2. WHEN MenoDAOPaymaster emits `ClaimValidated`, THE MenoDAOPaymaster SHALL include `resultHash` which is derived from the AI output that itself references the CIDs used during verification.
3. THE MenoDAOPaymaster SHALL store `beforeCID` and `afterCID` from the claim in the processed claim record accessible via a `getClaim(bytes32 claimId)` view function, so that off-chain indexers can retrieve the Filecoin evidence links.

---

### Requirement 6: Hardhat Deploy Script for MenoDAOPaymaster

**User Story:** As a developer, I want a Hardhat deploy script for MenoDAOPaymaster, so that the contract can be deployed to Filecoin Calibration testnet in a single command during the hackathon sprint.

#### Acceptance Criteria

1. THE deploy script SHALL deploy MenoDAOPaymaster to the network specified by the `--network` Hardhat flag, defaulting to `calibration`.
2. WHEN deployment succeeds, THE deploy script SHALL log the deployed contract address and the `agentSigner` address that was configured.
3. THE deploy script SHALL read `AGENT_SIGNER_ADDRESS` from environment variables and pass it to the MenoDAOPaymaster constructor.
4. WHEN deployment succeeds, THE deploy script SHALL write the deployed contract address to a `.env.paymaster` file in the contracts directory for easy copy-paste into the backend `.env`.
5. IF `AGENT_SIGNER_ADDRESS` is not set in the environment, THEN THE deploy script SHALL exit with a non-zero code and print `"AGENT_SIGNER_ADDRESS is required"`.

# Tasks: EIP-712 Signed Payouts

## Task List

- [x] 1. Create EIP712SignerService
  - [x] 1.1 Create `src/web3/eip712-signer.service.ts` with `signClaim`, `computeResultHash`, and `computeClaimId` methods
  - [x] 1.2 Implement EIP-712 domain with name `"MenoDAOClaimVault"`, version `"1"`, chainId `314159`, and `verifyingContract` from `CLAIM_VAULT_CONTRACT_ADDRESS`
  - [x] 1.3 Implement `computeResultHash`: `keccak256(abi.encode(verified: bool, confidence * 1e18: uint256, reason: string))`
  - [x] 1.4 Implement `computeClaimId`: `keccak256(abi.encode(caseOnChainId: uint256, visitId: string))`
  - [x] 1.5 Implement `signClaim` using ethers.js v6 `signTypedData` with `AGENT_SIGNER_PRIVATE_KEY`
  - [x] 1.6 Implement mock mode: when `AGENT_SIGNER_PRIVATE_KEY` or `CLAIM_VAULT_CONTRACT_ADDRESS` are absent, log `[MOCK]` and return deterministic fake `SignedClaim`

- [x] 2. Create MenoDAOClaimVault.sol
  - [x] 2.1 Create `contracts/src/MenoDAOClaimVault.sol` with EIP-712 domain (`"MenoDAOClaimVault"`, version `"1"`)
  - [x] 2.2 Define `PayoutClaim` and `StoredClaim` structs matching the design data models
  - [x] 2.3 Implement `executePayout(PayoutClaim calldata claim, bytes calldata signature)` with all validation checks in order: signature recovery, replay guard, whitelist, cap, balance
  - [x] 2.4 Implement revert messages: `"Invalid signer"`, `"Claim already processed"`, `"Clinic not whitelisted"`, `"Amount exceeds max payout"`, `"Insufficient contract balance"`, `"Transfer failed"`
  - [x] 2.5 Emit `ClaimValidated(bytes32 indexed claimId, bytes32 resultHash)` and `PayoutExecuted(bytes32 indexed claimId, address indexed recipient, uint256 amount)` events
  - [x] 2.6 Implement `addClinic(address)` and `removeClinic(address)` with `onlyOwner` modifier
  - [x] 2.7 Implement `getClaim(bytes32 claimId) external view returns (StoredClaim memory)`
  - [x] 2.8 Implement `receive() external payable` and `withdraw() external onlyOwner`

- [x] 3. Update BlockchainCaseService
  - [x] 3.1 Add `CLAIM_VAULT_ABI` constant with `executePayout`, `ClaimValidated`, and `PayoutExecuted` fragments
  - [x] 3.2 Load `CLAIM_VAULT_CONTRACT_ADDRESS` and `AGENT_SIGNER_PRIVATE_KEY` from config; initialize a separate `claimVaultContract` and `signerWallet` instance
  - [x] 3.3 Implement `submitSignedClaim(signedClaim: SignedClaim): Promise<string>` that calls `claimVaultContract.executePayout(claim, signature)` and returns the tx hash
  - [x] 3.4 Implement mock mode for `submitSignedClaim`: return fake tx hash and log `[MOCK]` when contract not initialized
  - [x] 3.5 Keep existing `submitCase` and `approveAndPay` methods unchanged

- [x] 4. Update CaseProcessorService
  - [x] 4.1 Inject `EIP712SignerService` into `CaseProcessorService` constructor
  - [x] 4.2 In `runPipelineInBackground` Step 3, replace `approveAndPay(caseId)` with: call `eip712Signer.signClaim(...)` then `blockchainCase.submitSignedClaim(signedClaim)`
  - [x] 4.3 Pass `clinicAddress`, `amountWei`, `aiResult`, `beforeCID`, `afterCID`, `caseId`, and `visitId` to `signClaim`
  - [x] 4.4 Handle `"Claim already processed"` revert: detect this string in the error message, set `web3VerificationStatus = VERIFIED` (not `REJECTED`), and log a warning

- [x] 5. Create deploy script `contracts/scripts/deploy-claim-vault.js`
  - [x] 5.1 Read `AGENT_SIGNER_ADDRESS` from env; exit with non-zero code and print `"AGENT_SIGNER_ADDRESS is required"` if absent
  - [x] 5.2 Deploy `MenoDAOClaimVault` passing `AGENT_SIGNER_ADDRESS` to the constructor
  - [x] 5.3 Log the deployed contract address and the configured `agentSigner` address
  - [x] 5.4 Write the deployed address to `contracts/.env.claimvault`

- [x] 6. Register EIP712SignerService in web3.module.ts
  - [x] 6.1 Add `EIP712SignerService` to the `providers` and `exports` arrays in `src/web3/web3.module.ts`

- [x] 7. Update environment variable documentation
  - [x] 7.1 Add `CLAIM_VAULT_CONTRACT_ADDRESS`, `AGENT_SIGNER_PRIVATE_KEY`, and `AGENT_SIGNER_ADDRESS` entries to `.env.example` with descriptive comments
  - [x] 7.2 Note the hackathon shortcut: `AGENT_SIGNER_PRIVATE_KEY` can equal `BLOCKCHAIN_PRIVATE_KEY` for demo purposes

- [-] 8. Property-based tests for EIP712SignerService
  - [x] 8.1 Install `fast-check` if not already present (`npm install --save-dev fast-check`)
  - [x] 8.2 Create `src/web3/eip712-signer.service.spec.ts`
  - [ ] 8.3 Write property test for `computeResultHash` determinism: `fc.record({ verified: fc.boolean(), confidence: fc.float({ min: 0, max: 1 }), reason: fc.string() })` → same inputs always produce same hash (min 100 iterations)
    - Tag: `// Feature: eip712-signed-payouts, Property 1: resultHash is deterministic`
  - [ ] 8.4 Write property test for `computeClaimId` determinism and uniqueness: same `(caseOnChainId, visitId)` always returns same value; distinct pairs return distinct values (min 100 iterations)
    - Tag: `// Feature: eip712-signed-payouts, Property 2: claimId uniqueness and determinism`
  - [ ] 8.5 Write property test for signature round-trip: generate random valid `PayoutClaim` fields → `signClaim` → recover signer from signature → assert recovered address equals `AGENT_SIGNER_ADDRESS` (min 100 iterations)
    - Tag: `// Feature: eip712-signed-payouts, Property 3: Signature round-trip recovers signer`

- [-] 9. Contract tests (Hardhat)
  - [x] 9.1 Create `contracts/test/MenoDAOClaimVault.test.js`
  - [ ] 9.2 Test all revert conditions: invalid signer, replay, non-whitelisted clinic, amount over cap, insufficient balance
  - [ ] 9.3 Test event emissions: `ClaimValidated` and `PayoutExecuted` with correct args using `expect(...).to.emit(...).withArgs(...)`
  - [ ] 9.4 Test balance changes: clinic balance increases by `claim.amount` on successful `executePayout` using `expect(...).to.changeEtherBalance(...)`
  - [ ] 9.5 Test `getClaim` round-trip: after successful `executePayout`, `getClaim(claimId)` returns `StoredClaim` with matching `beforeCID`, `afterCID`, `clinic`, `amount`, and `processed = true`
  - [ ] 9.6 Test `withdraw`: owner can withdraw full balance; non-owner reverts with `"Not owner"`

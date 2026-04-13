// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MenoDAO Claim Vault
 * @notice Deployed on Filecoin Calibration Testnet (chainId 314159).
 *
 * This contract is NOT an ERC-4337 Paymaster. It does not sponsor gas.
 * It is a Claim Vault: it holds payout funds (tFIL) sent by the Treasury,
 * verifies EIP-712 signed claims from the Agent Signer, enforces rules,
 * and releases funds to whitelisted clinics.
 *
 * Roles:
 *   - Owner (Deployer): deploys, manages clinic whitelist, can withdraw
 *   - Agent Signer: signs EIP-712 claims off-chain (does NOT hold funds)
 *   - Treasury: funds this contract via receive()
 *
 * Flow:
 *   1. AI verifies dental improvement off-chain
 *   2. Backend creates a PayoutClaim and signs it with EIP-712
 *   3. Backend calls executePayout(claim, signature)
 *   4. Contract verifies signature, enforces rules, pays clinic
 *   5. Events ClaimValidated and PayoutExecuted are emitted
 */
contract MenoDAOClaimVault {

    // ─── Structs ──────────────────────────────────────────────────────────────

    struct PayoutClaim {
        bytes32 claimId;      // keccak256(abi.encode(caseOnChainId, visitId))
        address clinic;       // recipient of payout
        uint256 amount;       // wei
        bytes32 resultHash;   // keccak256(abi.encode(verified, confidence_1e18, reason))
        uint256 timestamp;    // unix seconds at signing time
        string  beforeCID;    // Filecoin CID of before-treatment image
        string  afterCID;     // Filecoin CID of after-treatment image
    }

    struct StoredClaim {
        bytes32 claimId;
        address clinic;
        uint256 amount;
        bytes32 resultHash;
        uint256 timestamp;
        string  beforeCID;
        string  afterCID;
        bool    processed;
    }

    // ─── EIP-712 ──────────────────────────────────────────────────────────────

    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    bytes32 private constant PAYOUT_CLAIM_TYPEHASH = keccak256(
        "PayoutClaim(bytes32 claimId,address clinic,uint256 amount,bytes32 resultHash,uint256 timestamp,string beforeCID,string afterCID)"
    );

    bytes32 private immutable DOMAIN_SEPARATOR;

    // ─── State ────────────────────────────────────────────────────────────────

    address public owner;
    address public agentSigner;

    uint256 public constant MAX_PAYOUT = 0.01 ether;

    mapping(bytes32 => bool)         public processedClaims;
    mapping(address => bool)         public whitelistedClinics;
    mapping(bytes32 => StoredClaim)  private storedClaims;

    // ─── Events ───────────────────────────────────────────────────────────────

    event ClaimValidated(bytes32 indexed claimId, bytes32 resultHash);
    event PayoutExecuted(bytes32 indexed claimId, address indexed recipient, uint256 amount);
    event ClinicAdded(address indexed clinic);
    event ClinicRemoved(address indexed clinic);

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address _agentSigner) {
        require(_agentSigner != address(0), "Invalid agent signer");
        owner = msg.sender;
        agentSigner = _agentSigner;

        DOMAIN_SEPARATOR = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256(bytes("MenoDAOClaimVault")),
            keccak256(bytes("1")),
            block.chainid,
            address(this)
        ));
    }

    // ─── Core: executePayout ──────────────────────────────────────────────────

    /**
     * @notice Verify a signed claim and release payout to the clinic.
     * @param claim   The structured PayoutClaim data
     * @param signature  65-byte EIP-712 ECDSA signature from the Agent Signer
     */
    function executePayout(
        PayoutClaim calldata claim,
        bytes calldata signature
    ) external {
        // 1. Verify EIP-712 signature recovers to agentSigner
        bytes32 structHash = keccak256(abi.encode(
            PAYOUT_CLAIM_TYPEHASH,
            claim.claimId,
            claim.clinic,
            claim.amount,
            claim.resultHash,
            claim.timestamp,
            keccak256(bytes(claim.beforeCID)),
            keccak256(bytes(claim.afterCID))
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        address recovered = _recoverSigner(digest, signature);
        require(recovered == agentSigner, "Invalid signer");

        // 2. Replay protection
        require(!processedClaims[claim.claimId], "Claim already processed");

        // 3. Clinic whitelist
        require(whitelistedClinics[claim.clinic], "Clinic not whitelisted");

        // 4. Max payout cap
        require(claim.amount <= MAX_PAYOUT, "Amount exceeds max payout");

        // 5. Sufficient balance
        require(address(this).balance >= claim.amount, "Insufficient contract balance");

        // Mark processed and store claim data
        processedClaims[claim.claimId] = true;
        storedClaims[claim.claimId] = StoredClaim({
            claimId:    claim.claimId,
            clinic:     claim.clinic,
            amount:     claim.amount,
            resultHash: claim.resultHash,
            timestamp:  claim.timestamp,
            beforeCID:  claim.beforeCID,
            afterCID:   claim.afterCID,
            processed:  true
        });

        emit ClaimValidated(claim.claimId, claim.resultHash);

        // Execute transfer
        (bool success, ) = payable(claim.clinic).call{value: claim.amount}("");
        require(success, "Transfer failed");

        emit PayoutExecuted(claim.claimId, claim.clinic, claim.amount);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function addClinic(address clinic) external onlyOwner {
        require(clinic != address(0), "Invalid clinic address");
        whitelistedClinics[clinic] = true;
        emit ClinicAdded(clinic);
    }

    function removeClinic(address clinic) external onlyOwner {
        whitelistedClinics[clinic] = false;
        emit ClinicRemoved(clinic);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getClaim(bytes32 claimId) external view returns (StoredClaim memory) {
        return storedClaims[claimId];
    }

    function domainSeparator() external view returns (bytes32) {
        return DOMAIN_SEPARATOR;
    }

    // ─── Treasury ─────────────────────────────────────────────────────────────

    receive() external payable {}

    function withdraw() external onlyOwner {
        (bool success, ) = payable(owner).call{value: address(this).balance}("");
        require(success, "Withdraw failed");
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _recoverSigner(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        require(sig.length == 65, "Invalid signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "Invalid signature v value");
        return ecrecover(digest, v, r, s);
    }
}

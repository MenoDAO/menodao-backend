// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MenoDAO Dental Case Registry
 * @notice Deployed on Filecoin Calibration Testnet.
 *
 * Flow:
 *   1. Clinic staff uploads before/after images to Filecoin → gets CIDs
 *   2. Backend calls submitCase(beforeCID, afterCID, clinicAddress)
 *   3. AI agent verifies dental improvement off-chain
 *   4. Backend calls approveAndPay(caseId) → releases 0.01 tFIL to clinic
 *   5. Hypercert is minted off-chain as proof of impact
 *
 * Agent identity: did:menodao:verifier-1
 */
contract MenoDAOCases {
    struct Case {
        string beforeCID;   // Filecoin CID of before-treatment image
        string afterCID;    // Filecoin CID of after-treatment image
        address clinic;     // Clinic wallet that receives payout
        bool paid;          // Whether payout has been released
        uint256 submittedAt;
    }

    mapping(uint256 => Case) public cases;
    uint256 public caseCount;

    address public owner;

    event CaseSubmitted(uint256 indexed id, string beforeCID, string afterCID, address indexed clinic);
    event CaseVerified(uint256 indexed id, address indexed agent);
    event Paid(uint256 indexed id, address indexed clinic, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /**
     * @notice Submit a dental case with Filecoin CIDs.
     * @param beforeCID Filecoin CID of the before-treatment image
     * @param afterCID  Filecoin CID of the after-treatment image
     * @param clinic    Clinic wallet address to receive payout
     */
    function submitCase(
        string memory beforeCID,
        string memory afterCID,
        address clinic
    ) public returns (uint256) {
        require(bytes(beforeCID).length > 0, "beforeCID required");
        require(bytes(afterCID).length > 0, "afterCID required");
        require(clinic != address(0), "Invalid clinic address");

        uint256 id = caseCount;
        cases[id] = Case({
            beforeCID: beforeCID,
            afterCID: afterCID,
            clinic: clinic,
            paid: false,
            submittedAt: block.timestamp
        });

        emit CaseSubmitted(id, beforeCID, afterCID, clinic);
        caseCount++;
        return id;
    }

    /**
     * @notice Approve a verified case and release payout to the clinic.
     * @param id Case ID to approve and pay
     * @param payoutAmount Amount in wei to pay (allows flexible demo/prod amounts)
     */
    function approveAndPay(uint256 id, uint256 payoutAmount) public onlyOwner {
        Case storage c = cases[id];
        require(bytes(c.beforeCID).length > 0, "Case does not exist");
        require(!c.paid, "Already paid");
        require(address(this).balance >= payoutAmount, "Insufficient contract balance");

        c.paid = true;
        emit CaseVerified(id, msg.sender);

        (bool success, ) = payable(c.clinic).call{value: payoutAmount}("");
        require(success, "Transfer failed");

        emit Paid(id, c.clinic, payoutAmount);
    }

    /**
     * @notice Convenience overload — pays the default demo amount (0.001 ether).
     */
    function approveAndPay(uint256 id) public onlyOwner {
        approveAndPay(id, 0.001 ether);
    }

    /**
     * @notice Get case details by ID.
     */
    function getCase(uint256 id) public view returns (
        string memory beforeCID,
        string memory afterCID,
        address clinic,
        bool paid,
        uint256 submittedAt
    ) {
        Case storage c = cases[id];
        return (c.beforeCID, c.afterCID, c.clinic, c.paid, c.submittedAt);
    }

    /**
     * @notice Fund the contract with tFIL for payouts.
     */
    receive() external payable {}

    /**
     * @notice Withdraw remaining balance (owner only).
     */
    function withdraw() external onlyOwner {
        (bool success, ) = payable(owner).call{value: address(this).balance}("");
        require(success, "Withdraw failed");
    }
}

/**
 * MenoDAOClaimVault — Hardhat contract tests
 *
 * Tests all correctness properties from the spec:
 *   Property 4:  Invalid signer rejected
 *   Property 5:  Replay protection
 *   Property 6:  Clinic whitelist enforcement
 *   Property 7:  Max payout cap enforcement
 *   Property 8:  Correct transfer + events on valid claim
 *   Property 9:  Insufficient balance reverts
 *   Property 10: getClaim round-trip preserves CIDs
 *   Property 11: Withdraw restricted to owner
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CHAIN_ID = 31337; // Hardhat local network

async function buildDomain(vaultAddress) {
  return {
    name: 'MenoDAOClaimVault',
    version: '1',
    chainId: CHAIN_ID,
    verifyingContract: vaultAddress,
  };
}

const PAYOUT_CLAIM_TYPES = {
  PayoutClaim: [
    { name: 'claimId', type: 'bytes32' },
    { name: 'clinic', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'resultHash', type: 'bytes32' },
    { name: 'timestamp', type: 'uint256' },
    { name: 'beforeCID', type: 'string' },
    { name: 'afterCID', type: 'string' },
  ],
};

function makeClaim({
  claimId,
  clinic,
  amount,
  resultHash,
  timestamp,
  beforeCID,
  afterCID,
} = {}) {
  return {
    claimId: claimId ?? ethers.keccak256(ethers.toUtf8Bytes('test-claim-1')),
    clinic: clinic ?? ethers.ZeroAddress,
    amount: amount ?? ethers.parseEther('0.001'),
    resultHash: resultHash ?? ethers.keccak256(ethers.toUtf8Bytes('ai-result')),
    timestamp: timestamp ?? Math.floor(Date.now() / 1000),
    beforeCID: beforeCID ?? 'bafybefore123',
    afterCID: afterCID ?? 'bafyafter456',
  };
}

async function signClaim(signer, domain, claim) {
  return signer.signTypedData(domain, PAYOUT_CLAIM_TYPES, claim);
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('MenoDAOClaimVault', function () {
  let vault;
  let owner;
  let agentSigner;
  let clinic;
  let stranger;
  let domain;

  beforeEach(async function () {
    [owner, agentSigner, clinic, stranger] = await ethers.getSigners();

    const ClaimVault = await ethers.getContractFactory('MenoDAOClaimVault');
    vault = await ClaimVault.deploy(agentSigner.address);
    await vault.waitForDeployment();

    domain = await buildDomain(await vault.getAddress());

    // Whitelist the clinic
    await vault.connect(owner).addClinic(clinic.address);

    // Fund the vault with 0.1 ETH for payouts
    await owner.sendTransaction({
      to: await vault.getAddress(),
      value: ethers.parseEther('0.1'),
    });
  });

  // ─── Property 4: Invalid signer rejected ────────────────────────────────────

  it('Property 4: rejects claim signed by wrong signer', async function () {
    const claim = makeClaim({ clinic: clinic.address });
    const sig = await signClaim(stranger, domain, claim); // wrong signer

    await expect(
      vault.connect(stranger).executePayout(claim, sig),
    ).to.be.revertedWith('Invalid signer');
  });

  // ─── Property 5: Replay protection ──────────────────────────────────────────

  it('Property 5: rejects replay of already-processed claim', async function () {
    const claim = makeClaim({ clinic: clinic.address });
    const sig = await signClaim(agentSigner, domain, claim);

    await vault.executePayout(claim, sig);

    await expect(vault.executePayout(claim, sig)).to.be.revertedWith(
      'Claim already processed',
    );
  });

  // ─── Property 6: Clinic whitelist enforcement ────────────────────────────────

  it('Property 6: rejects claim for non-whitelisted clinic', async function () {
    const claim = makeClaim({ clinic: stranger.address }); // not whitelisted
    const sig = await signClaim(agentSigner, domain, claim);

    await expect(vault.executePayout(claim, sig)).to.be.revertedWith(
      'Clinic not whitelisted',
    );
  });

  it('Property 6b: allows payout after clinic is added to whitelist', async function () {
    await vault.connect(owner).addClinic(stranger.address);
    const claim = makeClaim({ clinic: stranger.address });
    const sig = await signClaim(agentSigner, domain, claim);

    await expect(vault.executePayout(claim, sig)).to.not.be.reverted;
  });

  it('Property 6c: rejects payout after clinic is removed from whitelist', async function () {
    await vault.connect(owner).removeClinic(clinic.address);
    const claim = makeClaim({ clinic: clinic.address });
    const sig = await signClaim(agentSigner, domain, claim);

    await expect(vault.executePayout(claim, sig)).to.be.revertedWith(
      'Clinic not whitelisted',
    );
  });

  // ─── Property 7: Max payout cap enforcement ──────────────────────────────────

  it('Property 7: rejects claim with amount exceeding MAX_PAYOUT (0.01 ether)', async function () {
    const claim = makeClaim({
      clinic: clinic.address,
      amount: ethers.parseEther('0.011'), // over cap
    });
    const sig = await signClaim(agentSigner, domain, claim);

    await expect(vault.executePayout(claim, sig)).to.be.revertedWith(
      'Amount exceeds max payout',
    );
  });

  it('Property 7b: accepts claim at exactly MAX_PAYOUT', async function () {
    const claim = makeClaim({
      clinic: clinic.address,
      amount: ethers.parseEther('0.01'), // exactly at cap
    });
    const sig = await signClaim(agentSigner, domain, claim);

    await expect(vault.executePayout(claim, sig)).to.not.be.reverted;
  });

  // ─── Property 8: Correct transfer + events on valid claim ───────────────────

  it('Property 8: emits ClaimValidated and PayoutExecuted on valid claim', async function () {
    const claim = makeClaim({ clinic: clinic.address });
    const sig = await signClaim(agentSigner, domain, claim);

    await expect(vault.executePayout(claim, sig))
      .to.emit(vault, 'ClaimValidated')
      .withArgs(claim.claimId, claim.resultHash)
      .and.to.emit(vault, 'PayoutExecuted')
      .withArgs(claim.claimId, clinic.address, claim.amount);
  });

  it('Property 8b: clinic balance increases by claim.amount on valid payout', async function () {
    const amount = ethers.parseEther('0.001');
    const claim = makeClaim({ clinic: clinic.address, amount });
    const sig = await signClaim(agentSigner, domain, claim);

    await expect(vault.executePayout(claim, sig)).to.changeEtherBalance(
      clinic,
      amount,
    );
  });

  // ─── Property 9: Insufficient balance reverts ────────────────────────────────

  it('Property 9: reverts when contract balance is less than claim amount', async function () {
    // Deploy a fresh vault with no funding
    const ClaimVault = await ethers.getContractFactory('MenoDAOClaimVault');
    const emptyVault = await ClaimVault.deploy(agentSigner.address);
    await emptyVault.waitForDeployment();
    await emptyVault.connect(owner).addClinic(clinic.address);

    const emptyDomain = await buildDomain(await emptyVault.getAddress());
    const claim = makeClaim({ clinic: clinic.address });
    const sig = await signClaim(agentSigner, emptyDomain, claim);

    await expect(emptyVault.executePayout(claim, sig)).to.be.revertedWith(
      'Insufficient contract balance',
    );
  });

  // ─── Property 10: getClaim round-trip preserves CIDs ────────────────────────

  it('Property 10: getClaim returns stored claim with correct CIDs after executePayout', async function () {
    const claim = makeClaim({
      clinic: clinic.address,
      beforeCID: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
      afterCID: 'bafybeiczsscdsbs7ffqz55asqdf3smv6klcw3gofszvwlyarci47bgf354',
    });
    const sig = await signClaim(agentSigner, domain, claim);

    await vault.executePayout(claim, sig);

    const stored = await vault.getClaim(claim.claimId);
    expect(stored.beforeCID).to.equal(claim.beforeCID);
    expect(stored.afterCID).to.equal(claim.afterCID);
    expect(stored.clinic).to.equal(clinic.address);
    expect(stored.amount).to.equal(claim.amount);
    expect(stored.processed).to.equal(true);
  });

  // ─── Property 11: Withdraw restricted to owner ──────────────────────────────

  it('Property 11: owner can withdraw full balance', async function () {
    const vaultAddress = await vault.getAddress();
    const balance = await ethers.provider.getBalance(vaultAddress);
    expect(balance).to.be.gt(0n);

    await expect(vault.connect(owner).withdraw()).to.changeEtherBalance(
      owner,
      balance,
    );
  });

  it('Property 11b: non-owner cannot withdraw', async function () {
    await expect(vault.connect(stranger).withdraw()).to.be.revertedWith(
      'Not owner',
    );
  });

  // ─── Admin: addClinic / removeClinic access control ─────────────────────────

  it('non-owner cannot call addClinic', async function () {
    await expect(
      vault.connect(stranger).addClinic(stranger.address),
    ).to.be.revertedWith('Not owner');
  });

  it('non-owner cannot call removeClinic', async function () {
    await expect(
      vault.connect(stranger).removeClinic(clinic.address),
    ).to.be.revertedWith('Not owner');
  });
});

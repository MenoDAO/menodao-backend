import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as fc from 'fast-check';
import { ethers } from 'ethers';
import { EIP712SignerService, SignClaimInput } from './eip712-signer.service';

// Deterministic test wallet — never use in production
const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_VAULT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

function makeConfigService(
  overrides: Record<string, string> = {},
): ConfigService {
  const values: Record<string, string> = {
    AGENT_SIGNER_PRIVATE_KEY: TEST_PRIVATE_KEY,
    CLAIM_VAULT_CONTRACT_ADDRESS: TEST_VAULT_ADDRESS,
    ...overrides,
  };
  return {
    get: (key: string) => values[key] ?? '',
  } as unknown as ConfigService;
}

async function buildService(
  overrides: Record<string, string> = {},
): Promise<EIP712SignerService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      EIP712SignerService,
      { provide: ConfigService, useValue: makeConfigService(overrides) },
    ],
  }).compile();
  return module.get<EIP712SignerService>(EIP712SignerService);
}

// ─── Unit tests ───────────────────────────────────────────────────────────────

describe('EIP712SignerService', () => {
  let service: EIP712SignerService;

  beforeEach(async () => {
    service = await buildService();
  });

  describe('computeResultHash', () => {
    it('returns a 32-byte hex string', () => {
      const hash = service.computeResultHash({
        verified: true,
        confidence: 0.9,
        reason: 'ok',
      });
      expect(hash).toMatch(/^0x[0-9a-f]{64}$/i);
    });

    it('returns different hashes for different inputs', () => {
      const h1 = service.computeResultHash({
        verified: true,
        confidence: 0.9,
        reason: 'ok',
      });
      const h2 = service.computeResultHash({
        verified: false,
        confidence: 0.1,
        reason: 'fail',
      });
      expect(h1).not.toBe(h2);
    });
  });

  describe('computeClaimId', () => {
    it('returns a 32-byte hex string', () => {
      const id = service.computeClaimId(42, 'visit-abc');
      expect(id).toMatch(/^0x[0-9a-f]{64}$/i);
    });

    it('returns different ids for different inputs', () => {
      const id1 = service.computeClaimId(1, 'visit-a');
      const id2 = service.computeClaimId(2, 'visit-a');
      expect(id1).not.toBe(id2);
    });
  });

  describe('signClaim', () => {
    it('returns a 65-byte (132 hex char) signature', async () => {
      const input: SignClaimInput = {
        caseOnChainId: 1,
        visitId: 'visit-test',
        clinicAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        amountWei: ethers.parseEther('0.001'),
        aiResult: {
          verified: true,
          confidence: 0.95,
          reason: 'Improvement detected',
        },
        beforeCID: 'bafybefore',
        afterCID: 'bafyafter',
      };
      const result = await service.signClaim(input);
      expect(result.signature).toMatch(/^0x[0-9a-f]{130}$/i);
    });

    it('returns mock signature when env vars absent', async () => {
      const mockService = await buildService({
        AGENT_SIGNER_PRIVATE_KEY: '',
        CLAIM_VAULT_CONTRACT_ADDRESS: '',
      });
      const result = await mockService.signClaim({
        caseOnChainId: 1,
        visitId: 'v',
        clinicAddress: '0x0000000000000000000000000000000000000001',
        amountWei: 1000n,
        aiResult: { verified: true, confidence: 0.9, reason: 'ok' },
        beforeCID: 'cid1',
        afterCID: 'cid2',
      });
      expect(result.signature).toBe('0x' + '0'.repeat(130));
    });
  });

  describe('getSignerAddress', () => {
    it('returns the expected address for the test key', () => {
      const wallet = new ethers.Wallet(TEST_PRIVATE_KEY);
      expect(service.getSignerAddress()).toBe(wallet.address);
    });
  });
});

// ─── Property-based tests ─────────────────────────────────────────────────────

describe('EIP712SignerService — property-based tests', () => {
  let service: EIP712SignerService;

  beforeEach(async () => {
    service = await buildService();
  });

  // Feature: eip712-signed-payouts, Property 1: resultHash is deterministic
  it('Property 1: computeResultHash is deterministic for same inputs', () => {
    fc.assert(
      fc.property(
        fc.record({
          verified: fc.boolean(),
          confidence: fc.float({
            min: Math.fround(0),
            max: Math.fround(1),
            noNaN: true,
          }),
          reason: fc.string({ maxLength: 200 }),
        }),
        (aiResult) => {
          const h1 = service.computeResultHash(aiResult);
          const h2 = service.computeResultHash(aiResult);
          return h1 === h2;
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: eip712-signed-payouts, Property 2: claimId uniqueness and determinism
  it('Property 2a: computeClaimId is deterministic for same inputs', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 1_000_000 }),
        fc.string({ maxLength: 100 }),
        (caseId, visitId) => {
          const id1 = service.computeClaimId(caseId, visitId);
          const id2 = service.computeClaimId(caseId, visitId);
          return id1 === id2;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 2b: computeClaimId produces distinct values for distinct inputs', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.tuple(fc.nat({ max: 1_000_000 }), fc.string({ maxLength: 50 })),
          { minLength: 2, maxLength: 2 },
        ),
        ([pair1, pair2]) => {
          const id1 = service.computeClaimId(pair1[0], pair1[1]);
          const id2 = service.computeClaimId(pair2[0], pair2[1]);
          // Different inputs should (with overwhelming probability) produce different hashes
          // This is a probabilistic property — collision probability is negligible
          return (
            id1 !== id2 || (pair1[0] === pair2[0] && pair1[1] === pair2[1])
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: eip712-signed-payouts, Property 3: Signature round-trip recovers signer
  it('Property 3: signClaim signature round-trip recovers the agent signer address', async () => {
    const signerAddress = service.getSignerAddress()!;
    const clinicAddress = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          caseOnChainId: fc.nat({ max: 100_000 }),
          visitId: fc.string({ minLength: 1, maxLength: 50 }),
          confidence: fc.float({
            min: Math.fround(0.7),
            max: Math.fround(1.0),
            noNaN: true,
          }),
          reason: fc.string({ maxLength: 100 }),
          beforeCID: fc.string({ minLength: 5, maxLength: 60 }),
          afterCID: fc.string({ minLength: 5, maxLength: 60 }),
        }),
        async ({
          caseOnChainId,
          visitId,
          confidence,
          reason,
          beforeCID,
          afterCID,
        }) => {
          const input: SignClaimInput = {
            caseOnChainId,
            visitId,
            clinicAddress,
            amountWei: ethers.parseEther('0.001'),
            aiResult: { verified: true, confidence, reason },
            beforeCID,
            afterCID,
          };

          const { claim, signature } = await service.signClaim(input);

          // Reconstruct the EIP-712 digest and recover the signer
          const domain = {
            name: 'MenoDAOClaimVault',
            version: '1',
            chainId: 314159,
            verifyingContract: TEST_VAULT_ADDRESS,
          };
          const types = {
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
          const recovered = ethers.verifyTypedData(
            domain,
            types,
            claim,
            signature,
          );
          return recovered.toLowerCase() === signerAddress.toLowerCase();
        },
      ),
      { numRuns: 20 }, // Reduced for async — still meaningful coverage
    );
  });
});

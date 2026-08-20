/**
 * Deploy MenoDAOClaimVault to Filecoin Calibration Testnet
 *
 * Prerequisites:
 *   1. Generate an Agent Signer wallet offline:
 *        node -e "const {ethers}=require('ethers'); const w=ethers.Wallet.createRandom(); console.log('address:',w.address); console.log('privateKey:',w.privateKey); console.log('mnemonic:',w.mnemonic.phrase);"
 *      Store the mnemonic in cold storage. Add the private key to your secrets manager.
 *
 *   2. Set in contracts/.env:
 *        DEPLOYER_PRIVATE_KEY=<deployer/owner key>
 *        AGENT_SIGNER_ADDRESS=<address of the agent signer wallet>
 *
 *   3. Fund the deployer wallet with tFIL: https://faucet.calibration.fildev.network/
 *
 *   4. Run:
 *        npx hardhat run scripts/deploy-claim-vault.js --network calibration
 *
 * After deployment:
 *   - Copy CLAIM_VAULT_CONTRACT_ADDRESS from contracts/.env.claimvault into backend .env
 *   - Add the clinic address to the whitelist:
 *       npx hardhat run scripts/add-clinic.js --network calibration
 *   - Fund the vault with tFIL (Treasury → contract):
 *       cast send <VAULT_ADDRESS> --value 0.1ether --private-key $DEPLOYER_PRIVATE_KEY --rpc-url $CALIBRATION_RPC
 *   - Add AGENT_SIGNER_PRIVATE_KEY to backend .env (hackathon: can equal BLOCKCHAIN_PRIVATE_KEY)
 *
 * Role separation:
 *   - DEPLOYER_PRIVATE_KEY  → owns contract, manages whitelist, can withdraw
 *   - AGENT_SIGNER_PRIVATE_KEY → signs EIP-712 claims + pays gas for executePayout (no funds)
 *   - Treasury wallet → funds the vault via receive() (no private key needed in backend)
 */

const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  // Validate required env
  const agentSignerAddress = process.env.AGENT_SIGNER_ADDRESS;
  if (!agentSignerAddress) {
    console.error('AGENT_SIGNER_ADDRESS is required');
    process.exit(1);
  }

  const network = hre.network.name;
  console.log(`\n🚀 Deploying MenoDAOClaimVault to ${network}...\n`);

  const [deployer] = await hre.ethers.getSigners();
  console.log('Deployer (owner):', deployer.address);
  console.log('Agent Signer:    ', agentSignerAddress);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  const currency = network === 'baseSepolia' ? 'ETH' : 'tFIL';
  console.log(
    'Deployer balance:',
    hre.ethers.formatEther(balance),
    currency,
    '\n',
  );

  if (balance === 0n) {
    const faucetUrl =
      network === 'baseSepolia'
        ? 'https://www.coinbase.com/faucets/base-ethereum-goerli-faucet'
        : 'https://faucet.calibration.fildev.network/';
    console.error(
      `❌ Deployer has no ${currency}. Get some from:\n   ${faucetUrl}`,
    );
    process.exit(1);
  }

  // Deploy MenoDAOClaimVault
  const ClaimVault = await hre.ethers.getContractFactory('MenoDAOClaimVault');
  const vault = await ClaimVault.deploy(agentSignerAddress);
  await vault.waitForDeployment();

  const vaultAddress = await vault.getAddress();
  const deployTx = vault.deploymentTransaction();

  console.log('✅ MenoDAOClaimVault deployed to:', vaultAddress);
  console.log('   Agent Signer configured:', agentSignerAddress);
  console.log('   Tx hash:', deployTx?.hash);
  const explorerBase =
    network === 'baseSepolia'
      ? 'https://sepolia.basescan.org/address/'
      : 'https://calibration.filfox.info/en/address/';
  console.log('   Explorer:', explorerBase + vaultAddress);
  console.log('');

  // Save deployment info
  const chainId = network === 'baseSepolia' ? 84532 : 314159;
  const info = {
    network,
    chainId,
    contractAddress: vaultAddress,
    agentSigner: agentSignerAddress,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    txHash: deployTx?.hash,
    explorerUrl: explorerBase + vaultAddress,
  };

  const deploymentsDir = path.join(__dirname, '../deployments');
  if (!fs.existsSync(deploymentsDir))
    fs.mkdirSync(deploymentsDir, { recursive: true });
  fs.writeFileSync(
    path.join(deploymentsDir, 'claim-vault.json'),
    JSON.stringify(info, null, 2),
  );

  // Write .env.claimvault for easy copy-paste
  const envContent = [
    `# MenoDAOClaimVault deployment — ${new Date().toISOString()}`,
    `# Network: ${network} (chainId: ${chainId})`,
    `CLAIM_VAULT_CONTRACT_ADDRESS=${vaultAddress}`,
    `CLAIM_VAULT_CHAIN_ID=${chainId}`,
    `AGENT_SIGNER_ADDRESS=${agentSignerAddress}`,
    `# Do not commit this file. AGENT_SIGNER_PRIVATE_KEY belongs in Secrets Manager only.`,
  ].join('\n');

  fs.writeFileSync(path.join(__dirname, '../.env.claimvault'), envContent);

  console.log('📄 Deployment saved to contracts/deployments/claim-vault.json');
  console.log('📄 Env vars written to contracts/.env.claimvault');
  console.log('\n⚡ Next steps:');
  console.log(`   1. Copy to backend .env:`);
  console.log(`      CLAIM_VAULT_CONTRACT_ADDRESS=${vaultAddress}`);
  console.log(`      AGENT_SIGNER_ADDRESS=${agentSignerAddress}`);
  console.log(`      AGENT_SIGNER_PRIVATE_KEY=<your agent signer private key>`);
  console.log(
    `   2. Whitelist clinic addresses (run add-clinic script or call addClinic directly)`,
  );
  console.log(`   3. Fund the vault with tFIL:`);
  console.log(
    `      cast send ${vaultAddress} --value 0.1ether --private-key $DEPLOYER_PRIVATE_KEY --rpc-url $CALIBRATION_RPC`,
  );
  console.log('');

  return info;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Deploy failed:', err);
    process.exit(1);
  });

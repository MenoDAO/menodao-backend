/**
 * Deploy MenoDAOCases to Filecoin Calibration Testnet
 *
 * Prerequisites:
 *   1. Set DEPLOYER_PRIVATE_KEY in contracts/.env
 *   2. Fund the deployer wallet with tFIL from https://faucet.calibration.fildev.network/
 *   3. Run: npx hardhat run scripts/deploy-calibration.js --network calibration
 *
 * After deployment:
 *   - Copy the contract address into backend .env as MENODAO_CONTRACT_ADDRESS
 *   - Fund the contract with tFIL so approveAndPay can release payouts:
 *       cast send <CONTRACT_ADDRESS> --value 0.1ether --private-key $DEPLOYER_PRIVATE_KEY --rpc-url $CALIBRATION_RPC
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const network = hre.network.name;
  console.log(`\n🚀 Deploying MenoDAOCases to ${network}...\n`);

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance:", hre.ethers.formatEther(balance), "tFIL\n");

  if (balance === 0n) {
    console.error("❌ Deployer has no tFIL. Get some from:");
    console.error("   https://faucet.calibration.fildev.network/");
    process.exit(1);
  }

  // Deploy MenoDAOCases
  const MenoDAOCases = await hre.ethers.getContractFactory("MenoDAOCases");
  const cases = await MenoDAOCases.deploy();
  await cases.waitForDeployment();

  const contractAddress = await cases.getAddress();
  const deployTx = cases.deploymentTransaction();

  console.log("✅ MenoDAOCases deployed to:", contractAddress);
  console.log("   Tx hash:", deployTx?.hash);
  console.log("   Explorer: https://calibration.filfox.info/en/address/" + contractAddress);
  console.log("");

  // Fund the contract with 0.05 tFIL for demo payouts
  console.log("💰 Funding contract with 0.05 tFIL for demo payouts...");
  try {
    const fundTx = await deployer.sendTransaction({
      to: contractAddress,
      value: hre.ethers.parseEther("0.05"),
    });
    await fundTx.wait();
    console.log("✅ Contract funded. Tx:", fundTx.hash);
  } catch (err) {
    console.warn("⚠️  Could not auto-fund contract:", err.message);
    console.warn("   Fund manually: send tFIL to", contractAddress);
  }

  // Test submitCase
  console.log("\n🧪 Testing submitCase...");
  try {
    const tx = await cases.submitCase(
      "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
      "bafybeiczsscdsbs7ffqz55asqdf3smv6klcw3gofszvwlyarci47bgf354",
      deployer.address
    );
    const receipt = await tx.wait();
    console.log("✅ Test case submitted. Tx:", receipt.hash);
    console.log("   Case ID: 0");
  } catch (err) {
    console.warn("⚠️  Test submitCase failed:", err.message);
  }

  // Save deployment info
  const info = {
    network,
    chainId: 314159,
    contractAddress,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    txHash: deployTx?.hash,
    explorerUrl: "https://calibration.filfox.info/en/address/" + contractAddress,
  };

  const dir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "calibration.json"), JSON.stringify(info, null, 2));

  console.log("\n📄 Deployment saved to contracts/deployments/calibration.json");
  console.log("\n⚡ Next step — add to backend .env:");
  console.log(`   MENODAO_CONTRACT_ADDRESS=${contractAddress}`);
  console.log(`   CALIBRATION_RPC=https://api.calibration.node.glif.io/rpc/v1`);
  console.log("");

  return info;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Deploy failed:", err);
    process.exit(1);
  });

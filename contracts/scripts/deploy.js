const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const network = hre.network.name;
  console.log(`\n🚀 Deploying MenoDAO Membership NFT to ${network}...\n`);

  // Get deployer
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer address:", deployer.address);
  
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:", hre.ethers.formatEther(balance), "ETH/native\n");

  // Deploy contract
  const MenoDAOMembership = await hre.ethers.getContractFactory("MenoDAOMembership");
  const membership = await MenoDAOMembership.deploy();
  
  await membership.waitForDeployment();
  const contractAddress = await membership.getAddress();

  console.log("✅ MenoDAOMembership deployed to:", contractAddress);
  console.log(`   Explorer: ${getExplorerUrl(network, contractAddress)}\n`);

  // Save deployment info
  const deploymentInfo = {
    network,
    chainId: hre.network.config.chainId,
    contractAddress,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    txHash: membership.deploymentTransaction()?.hash,
  };

  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deploymentFile = path.join(deploymentsDir, `${network}.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
  console.log(`📄 Deployment info saved to: ${deploymentFile}\n`);

  // Test minting (optional)
  console.log("🧪 Testing mint function...");
  try {
    const tx = await membership.mint(deployer.address, 1); // Mint Bronze
    await tx.wait();
    console.log("✅ Test mint successful! Token ID: 0\n");
    
    // Get token URI
    const tokenURI = await membership.tokenURI(0);
    console.log("📝 Token URI (first 200 chars):", tokenURI.substring(0, 200) + "...\n");
  } catch (error) {
    console.log("⚠️  Test mint skipped:", error.message, "\n");
  }

  // Verification instructions
  console.log("📋 To verify on block explorer, run:");
  console.log(`   npx hardhat verify --network ${network} ${contractAddress}\n`);

  return deploymentInfo;
}

function getExplorerUrl(network, address) {
  const explorers = {
    polygonAmoy: `https://amoy.polygonscan.com/address/${address}`,
    baseSepolia: `https://sepolia.basescan.org/address/${address}`,
    celoAlfajores: `https://alfajores.celoscan.io/address/${address}`,
    polygon: `https://polygonscan.com/address/${address}`,
    base: `https://basescan.org/address/${address}`,
    celo: `https://celoscan.io/address/${address}`,
  };
  return explorers[network] || `Unknown network: ${network}`;
}

main()
  .then((info) => {
    console.log("🎉 Deployment complete!\n");
    console.log("Contract Address:", info.contractAddress);
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });

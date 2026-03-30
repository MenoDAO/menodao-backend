const { ethers } = require('hardhat');

async function main() {
  const CONTRACT = '0xa1Be4905B2E8C1d4c7dFD32113751D9eF4a9e521';
  const [signer] = await ethers.getSigners();

  console.log('Funding contract from:', signer.address);
  const balBefore = await ethers.provider.getBalance(signer.address);
  console.log('Wallet balance:', ethers.formatEther(balBefore), 'tFIL');

  const tx = await signer.sendTransaction({
    to: CONTRACT,
    value: ethers.parseEther('0.1'),
  });
  console.log('Fund tx:', tx.hash);
  console.log(
    'Explorer:',
    `https://calibration.filfox.info/en/message/${tx.hash}`,
  );

  await tx.wait();

  const contractBal = await ethers.provider.getBalance(CONTRACT);
  console.log('Contract balance:', ethers.formatEther(contractBal), 'tFIL ✅');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

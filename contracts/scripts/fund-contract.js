const { ethers } = require('hardhat');

async function main() {
  const CONTRACT = '0x660BDB1B39B5c211cFca912Fd0452E0c7ad5907B';
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

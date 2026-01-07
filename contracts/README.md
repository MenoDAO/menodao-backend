# MenoDAO Smart Contracts

ERC-721 NFT contract for MenoDAO dental care membership.

## Features

- **Three Tiers**: Bronze, Silver, Gold memberships
- **Soulbound by Default**: NFTs can't be transferred until released
- **On-chain SVG**: Metadata and images stored on-chain
- **Multi-chain**: Deployable to Polygon, Base, and Celo

## Setup

```bash
cd contracts
npm install
cp .env.example .env
# Edit .env with your deployer private key
```

## Get Testnet Tokens

Before deploying, you need testnet tokens:

1. **Polygon Amoy**: https://faucet.polygon.technology/
2. **Base Sepolia**: https://www.alchemy.com/faucets/base-sepolia
3. **Celo Alfajores**: https://faucet.celo.org/alfajores

## Deploy

```bash
# Compile contracts
npm run compile

# Deploy to testnets
npm run deploy:polygon-testnet
npm run deploy:base-testnet
npm run deploy:celo-testnet

# Or deploy to all testnets at once
npm run deploy:all-testnets
```

## Contract Functions

### Owner Functions
- `mint(address to, uint256 tier)` - Mint NFT (1=Bronze, 2=Silver, 3=Gold)
- `upgradeTier(uint256 tokenId, uint256 newTier)` - Upgrade tier
- `releaseSoulbound(uint256 tokenId)` - Allow NFT to be transferred

### View Functions
- `getMembership(uint256 tokenId)` - Get membership data
- `getTokensByOwner(address owner)` - Get all tokens for owner
- `tokenURI(uint256 tokenId)` - Get on-chain metadata

## After Deployment

Add the contract addresses to your backend `.env`:

```env
POLYGON_NFT_CONTRACT=0x...
BASE_NFT_CONTRACT=0x...
CELO_NFT_CONTRACT=0x...
BLOCKCHAIN_PRIVATE_KEY=0x... # Same as DEPLOYER_PRIVATE_KEY
```

/**
 * Multi-chain configuration for MenoDAO
 * Supports Polygon, Base, and Celo networks
 */

export type ChainId = 'polygon' | 'base' | 'celo';

export interface ChainConfig {
  id: ChainId;
  name: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  testnet?: {
    chainId: number;
    rpcUrl: string;
    explorerUrl: string;
  };
}

export const CHAIN_CONFIGS: Record<ChainId, ChainConfig> = {
  polygon: {
    id: 'polygon',
    name: 'Polygon',
    chainId: 137,
    rpcUrl: 'https://polygon-rpc.com',
    explorerUrl: 'https://polygonscan.com',
    nativeCurrency: {
      name: 'MATIC',
      symbol: 'MATIC',
      decimals: 18,
    },
    testnet: {
      chainId: 80002,
      rpcUrl: 'https://rpc-amoy.polygon.technology',
      explorerUrl: 'https://amoy.polygonscan.com',
    },
  },
  base: {
    id: 'base',
    name: 'Base',
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    explorerUrl: 'https://basescan.org',
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'ETH',
      decimals: 18,
    },
    testnet: {
      chainId: 84532,
      rpcUrl: 'https://sepolia.base.org',
      explorerUrl: 'https://sepolia.basescan.org',
    },
  },
  celo: {
    id: 'celo',
    name: 'Celo',
    chainId: 42220,
    rpcUrl: 'https://forno.celo.org',
    explorerUrl: 'https://celoscan.io',
    nativeCurrency: {
      name: 'CELO',
      symbol: 'CELO',
      decimals: 18,
    },
    testnet: {
      chainId: 44787,
      rpcUrl: 'https://alfajores-forno.celo-testnet.org',
      explorerUrl: 'https://alfajores.celoscan.io',
    },
  },
};

/**
 * Get chain config by ID
 */
export function getChainConfig(
  chainId: ChainId,
  useTestnet = false,
): ChainConfig & {
  activeChainId: number;
  activeRpcUrl: string;
  activeExplorerUrl: string;
} {
  const config = CHAIN_CONFIGS[chainId];

  if (useTestnet && config.testnet) {
    return {
      ...config,
      activeChainId: config.testnet.chainId,
      activeRpcUrl: config.testnet.rpcUrl,
      activeExplorerUrl: config.testnet.explorerUrl,
    };
  }

  return {
    ...config,
    activeChainId: config.chainId,
    activeRpcUrl: config.rpcUrl,
    activeExplorerUrl: config.explorerUrl,
  };
}

/**
 * Default chain for MenoDAO (Polygon for low fees)
 */
export const DEFAULT_CHAIN: ChainId = 'polygon';

/**
 * Wallet utilities for real USDC transfers on Base Sepolia
 * Uses viem for blockchain interactions
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  type Address,
  type Hash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

// USDC contract on Base Sepolia
const USDC_CONTRACT_ADDRESS = '0x036cbd53842c5426634e7929541ec2318f3dcf7e' as const;

// USDC has 6 decimals
const USDC_DECIMALS = 6;

// ERC-20 ABI for transfer and balanceOf
const ERC20_ABI = [
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'decimals',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
] as const;

// Get environment variables
function getEnvConfig() {
  const privateKey = process.env.AGENT_PRIVATE_KEY;
  const recipientAddress = process.env.RECIPIENT_WALLET_ADDRESS;
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';

  return { privateKey, recipientAddress, rpcUrl };
}

// Validate wallet configuration
export function validateWalletConfig(): { valid: boolean; error?: string } {
  const { privateKey, recipientAddress } = getEnvConfig();

  if (!privateKey) {
    return { valid: false, error: 'AGENT_PRIVATE_KEY not configured' };
  }

  if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
    return { valid: false, error: 'AGENT_PRIVATE_KEY must be a 64-character hex string starting with 0x' };
  }

  if (!recipientAddress) {
    return { valid: false, error: 'RECIPIENT_WALLET_ADDRESS not configured' };
  }

  if (!recipientAddress.startsWith('0x') || recipientAddress.length !== 42) {
    return { valid: false, error: 'RECIPIENT_WALLET_ADDRESS must be a 40-character hex string starting with 0x' };
  }

  return { valid: true };
}

// Create viem clients
export function createClients() {
  const { privateKey, rpcUrl } = getEnvConfig();

  if (!privateKey) {
    throw new Error('AGENT_PRIVATE_KEY not configured');
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  return { publicClient, walletClient, account };
}

// Get the agent's wallet address
export function getAgentAddress(): Address {
  const { privateKey } = getEnvConfig();

  if (!privateKey) {
    throw new Error('AGENT_PRIVATE_KEY not configured');
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  return account.address;
}

// Get USDC balance for an address
export async function getUSDCBalance(address?: Address): Promise<{
  raw: bigint;
  formatted: string;
  sufficient: (amount: number) => boolean;
}> {
  const { publicClient } = createClients();
  const targetAddress = address || getAgentAddress();

  const balance = await publicClient.readContract({
    address: USDC_CONTRACT_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [targetAddress],
  });

  const formatted = formatUnits(balance, USDC_DECIMALS);

  return {
    raw: balance,
    formatted,
    sufficient: (amount: number) => {
      const requiredAmount = parseUnits(amount.toString(), USDC_DECIMALS);
      return balance >= requiredAmount;
    },
  };
}

// Transfer USDC to the recipient
export async function transferUSDC(amount: number): Promise<{
  success: boolean;
  txHash?: Hash;
  txLink?: string;
  error?: string;
}> {
  const { recipientAddress } = getEnvConfig();

  if (!recipientAddress) {
    return { success: false, error: 'RECIPIENT_WALLET_ADDRESS not configured' };
  }

  try {
    // Check balance first
    const balance = await getUSDCBalance();
    if (!balance.sufficient(amount)) {
      return {
        success: false,
        error: `Insufficient USDC balance. Have ${balance.formatted} USDC, need ${amount} USDC`,
      };
    }

    const { publicClient, walletClient, account } = createClients();

    // Convert amount to USDC units (6 decimals)
    const amountInUnits = parseUnits(amount.toString(), USDC_DECIMALS);

    // Simulate the transaction first
    const { request } = await publicClient.simulateContract({
      account,
      address: USDC_CONTRACT_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [recipientAddress as Address, amountInUnits],
    });

    // Execute the transaction
    const txHash = await walletClient.writeContract(request);

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      confirmations: 1,
    });

    if (receipt.status === 'success') {
      return {
        success: true,
        txHash,
        txLink: getBaseScanLink(txHash),
      };
    } else {
      return {
        success: false,
        error: 'Transaction reverted',
        txHash,
        txLink: getBaseScanLink(txHash),
      };
    }
  } catch (error) {
    console.error('USDC transfer error:', error);

    // Extract meaningful error message
    let errorMessage = 'Transaction failed';
    if (error instanceof Error) {
      // Common error patterns
      if (error.message.includes('insufficient funds')) {
        errorMessage = 'Insufficient ETH for gas fees';
      } else if (error.message.includes('nonce')) {
        errorMessage = 'Transaction nonce error - please try again';
      } else if (error.message.includes('rejected')) {
        errorMessage = 'Transaction rejected';
      } else {
        errorMessage = error.message.slice(0, 100); // Truncate long messages
      }
    }

    return { success: false, error: errorMessage };
  }
}

// Generate BaseScan link for a transaction
export function getBaseScanLink(txHash: Hash): string {
  return `https://sepolia.basescan.org/tx/${txHash}`;
}

// Get wallet info for logging/debugging
export async function getWalletInfo(): Promise<{
  agentAddress: Address;
  recipientAddress: Address | null;
  usdcBalance: string;
  network: string;
}> {
  const { recipientAddress } = getEnvConfig();
  const agentAddress = getAgentAddress();
  const balance = await getUSDCBalance();

  return {
    agentAddress,
    recipientAddress: recipientAddress as Address | null,
    usdcBalance: balance.formatted,
    network: 'Base Sepolia',
  };
}

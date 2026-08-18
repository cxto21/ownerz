import { Contract, RpcProvider } from 'starknet';
import FileVaultABI from './filevault-abi.json';

if (typeof window !== 'undefined') {
  console.log('[filevault] ABI loaded:', Array.isArray(FileVaultABI), FileVaultABI?.length, 'entries');
}

const VAULT_ADDRESS = process.env.NEXT_PUBLIC_FILEVAULT_ADDRESS;
const STRK_TOKEN_ADDRESS = process.env.NEXT_PUBLIC_STRK_TOKEN || '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

// Direct RPC provider for read-only calls (bypasses wallet)
const RPC_URL = process.env.NEXT_PUBLIC_STARKNET_RPC || 'https://starknet-sepolia.public.blastapi.io/rpc/v0_8'
const readProvider = new RpcProvider({ nodeUrl: RPC_URL })

// Minimal ABI for ERC20 approve (selector for approve(address,uint256))
const ERC20_APPROVE_ABI = [
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'core::starknet::contract_address::ContractAddress' },
      { name: 'amount', type: 'core::integer::u256' }
    ],
    outputs: [{ name: 'success', type: 'core::bool' }],
    state_mutability: 'external'
  }
];

/**
 * Get the platform fee from the vault contract
 * @returns {Promise<bigint>} Fee in wei
 */
export async function getPlatformFee() {
  if (!VAULT_ADDRESS) throw new Error('NEXT_PUBLIC_FILEVAULT_ADDRESS not set');
  try {
    const contract = new Contract({ abi: FileVaultABI, address: VAULT_ADDRESS, providerOrAccount: readProvider });
    const fee = await contract.get_platform_fee();
    return typeof fee === 'object' && fee.low !== undefined
      ? BigInt(fee.low) + (BigInt(fee.high) << BigInt(128))
      : BigInt(fee);
  } catch {
    return BigInt(500000000000000000); // default 0.5 STRK
  }
}

/**
 * Create a new vault on the FileVault contract.
 * Uses multicall: approve STRK fee + create_vault in ONE transaction = one wallet popup.
 * @param {Object} account - WalletAccountV6 instance
 * @param {Object} params - Vault parameters
 * @param {string} params.cid - Content identifier (felt252)
 * @param {bigint} params.price - Price in STRK smallest units (u256)
 * @param {string} params.keySeedCiphertext - Encrypted key seed (felt252)
 * @param {string} params.commitment - Commitment hash (felt252)
 * @param {number} params.ttl - Time to live in seconds
 * @param {bigint} params.fee - Platform fee in wei to approve
 * @returns {Promise<Object>} Transaction result
 */
export async function createVault(account, { cid, price, keySeedCiphertext, commitment, ttl, fee }) {
  if (!VAULT_ADDRESS) throw new Error('NEXT_PUBLIC_FILEVAULT_ADDRESS not set');

  const feeAmount = fee || BigInt(500000000000000000); // default 0.5 STRK
  const feeHigh = feeAmount >> BigInt(128);
  const feeLow = feeAmount & BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF');
  const priceHigh = price >> BigInt(128);
  const priceLow = price & BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF');

  console.log('[createVault] multicall: approve + create_vault, fee:', feeAmount.toString())

  // Multicall: approve STRK to vault contract, then create_vault
  // This is ONE transaction = ONE wallet popup
  const result = await account.execute([
    // Call 1: STRK token approve — allow vault contract to pull fee
    {
      contractAddress: STRK_TOKEN_ADDRESS,
      entrypoint: 'approve',
      calldata: [VAULT_ADDRESS, feeLow.toString(), feeHigh.toString()]
    },
    // Call 2: create_vault — vault pulls fee internally via transferFrom
    {
      contractAddress: VAULT_ADDRESS,
      entrypoint: 'create_vault',
      calldata: [
        cid,
        priceLow.toString(), priceHigh.toString(),
        keySeedCiphertext,
        commitment,
        ttl.toString()
      ]
    }
  ]);

  console.log('[createVault] result:', JSON.stringify(result, (k, v) => typeof v === 'bigint' ? v.toString() : v))
  return result;
}

/**
 * Claim a vault by providing the correct claim_secret
 */
export async function claimVault(account, cid, claimSecret) {
  if (!VAULT_ADDRESS) throw new Error('NEXT_PUBLIC_FILEVAULT_ADDRESS not set');
  const contract = new Contract({ abi: FileVaultABI, address: VAULT_ADDRESS, providerOrAccount: account });
  const result = await contract.claim_vault(cid, claimSecret);
  return result;
}

/**
 * Get vault information
 */
export async function getVault(provider, cid) {
  if (!VAULT_ADDRESS) throw new Error('NEXT_PUBLIC_FILEVAULT_ADDRESS not set');

  try {
    const contract = new Contract({ abi: FileVaultABI, address: VAULT_ADDRESS, providerOrAccount: readProvider });
    const vault = await contract.get_vault(cid);
    console.log('[getVault] raw response:', JSON.stringify(vault, (k, v) => typeof v === 'bigint' ? v.toString() : v));

    let priceBigInt;
    if (vault.price && typeof vault.price === 'object' && vault.price.low !== undefined) {
      priceBigInt = BigInt(vault.price.low) + (BigInt(vault.price.high) << BigInt(128));
    } else if (typeof vault.price === 'string' || typeof vault.price === 'bigint') {
      priceBigInt = BigInt(vault.price);
    } else {
      priceBigInt = BigInt(0);
    }

    return {
      seller: vault.seller,
      price: priceBigInt,
      keySeedCiphertext: vault.key_seed_ciphertext,
      commitment: vault.commitment,
      status: vault.status,
      createdAt: vault.created_at,
      ttl: vault.ttl,
    };
  } catch (e) {
    console.error('[getVault] error:', e.message, e.stack)
    return null;
  }
}

/**
 * Get vault price
 */
export async function getPrice(provider, cid) {
  if (!VAULT_ADDRESS) throw new Error('NEXT_PUBLIC_FILEVAULT_ADDRESS not set');
  try {
    const contract = new Contract({ abi: FileVaultABI, address: VAULT_ADDRESS, providerOrAccount: readProvider });
    const price = await contract.get_price(cid);
    if (price && typeof price === 'object' && price.low !== undefined) {
      return BigInt(price.low) + (BigInt(price.high) << BigInt(128));
    }
    return BigInt(price);
  } catch (e) {
    return null;
  }
}

/**
 * Get vault status (0=Active, 1=Claimed, 2=Refunded)
 */
export async function getStatus(provider, cid) {
  if (!VAULT_ADDRESS) throw new Error('NEXT_PUBLIC_FILEVAULT_ADDRESS not set');
  try {
    const contract = new Contract({ abi: FileVaultABI, address: VAULT_ADDRESS, providerOrAccount: readProvider });
    const status = await contract.get_status(cid);
    return Number(status);
  } catch (e) {
    return null;
  }
}

/**
 * Refund a vault (seller only, after TTL)
 */
export async function refundVault(account, cid) {
  if (!VAULT_ADDRESS) throw new Error('NEXT_PUBLIC_FILEVAULT_ADDRESS not set');
  const contract = new Contract({ abi: FileVaultABI, address: VAULT_ADDRESS, providerOrAccount: account });
  const result = await contract.refund_vault(cid);
  return result;
}

/**
 * Convert CID string to felt252
 */
export async function cidToFelt(cid) {
  const encoder = new TextEncoder();
  const data = encoder.encode(cid);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer).slice(0, 31);
  return '0x' + Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Deploy FileVault contract to Starknet
 */
export async function deployContract(account) {
  if (!account) throw new Error('Wallet not connected');
  const response = await fetch('/contracts/filevault.json');
  const contractClass = await response.json();
  const result = await account.declareAndDeploy({
    contract: contractClass,
    constructor: [],
  });
  return result.deploy.contract_address;
}

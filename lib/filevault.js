import { Contract, RpcProvider } from 'starknet';
import FileVaultABI from './filevault-abi.json';

// Debug: verify ABI loads
if (typeof window !== 'undefined') {
  console.log('[filevault] ABI loaded:', Array.isArray(FileVaultABI), FileVaultABI?.length, 'entries');
}

const VAULT_ADDRESS = process.env.NEXT_PUBLIC_FILEVAULT_ADDRESS;

// Direct RPC provider for read-only calls (bypasses wallet)
const RPC_URL = process.env.NEXT_PUBLIC_STARKNET_RPC || 'https://starknet-sepolia.public.blastapi.io/rpc/v0_8'
const readProvider = new RpcProvider({ nodeUrl: RPC_URL })

/**
 * Create a new vault on the FileVault contract
 * @param {Object} account - WalletAccountV6 instance
 * @param {Object} params - Vault parameters
 * @param {string} params.cid - Content identifier (felt252)
 * @param {bigint} params.price - Price in STRK smallest units (u256)
 * @param {string} params.keySeedCiphertext - Encrypted key seed (felt252)
 * @param {string} params.commitment - Commitment hash (felt252)
 * @param {number} params.ttl - Time to live in seconds
 * @returns {Promise<Object>} Transaction result
 */
export async function createVault(account, { cid, price, keySeedCiphertext, commitment, ttl }) {
  if (!VAULT_ADDRESS) {
    throw new Error('NEXT_PUBLIC_FILEVAULT_ADDRESS not set');
  }

  const contract = new Contract({ abi: FileVaultABI, address: VAULT_ADDRESS, providerOrAccount: account });
  
  const result = await contract.create_vault(
    cid,
    { low: price & BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'), high: price >> BigInt(128) },
    keySeedCiphertext,
    commitment,
    ttl
  );
  
  console.log('[createVault] result:', JSON.stringify(result, (k, v) => typeof v === 'bigint' ? v.toString() : v))

  return result;
}

/**
 * Claim a vault by providing the correct claim_secret
 * @param {Object} account - WalletAccountV6 instance
 * @param {string} cid - Content identifier (felt252)
 * @param {number} claimSecret - 16-bit claim secret
 * @returns {Promise<Object>} Transaction result
 */
export async function claimVault(account, cid, claimSecret) {
  if (!VAULT_ADDRESS) {
    throw new Error('NEXT_PUBLIC_FILEVAULT_ADDRESS not set');
  }

  const contract = new Contract({ abi: FileVaultABI, address: VAULT_ADDRESS, providerOrAccount: account });
  const result = await contract.claim_vault(cid, claimSecret);
  return result;
}

/**
 * Get vault information
 * @param {Provider} provider - Starknet provider
 * @param {string} cid - Content identifier (felt252)
 * @returns {Promise<Object|null>} Vault data or null if not found
 */
export async function getVault(provider, cid) {
  if (!VAULT_ADDRESS) {
    throw new Error('NEXT_PUBLIC_FILEVAULT_ADDRESS not set');
  }

  try {
    const contract = new Contract({ abi: FileVaultABI, address: VAULT_ADDRESS, providerOrAccount: readProvider });
    const vault = await contract.get_vault(cid);
    console.log('[getVault] raw response:', JSON.stringify(vault, (k, v) => typeof v === 'bigint' ? v.toString() : v));
    
    // Parse price: starknet.js v10 may return u256 as flat string or {low, high}
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
    // VAULT_NOT_FOUND or other error
    console.error('[getVault] error:', e.message, e.stack)
    return null;
  }
}

/**
 * Get vault price
 * @param {Provider} provider - Starknet provider
 * @param {string} cid - Content identifier (felt252)
 * @returns {Promise<bigint|null>} Price or null if not found
 */
export async function getPrice(provider, cid) {
  if (!VAULT_ADDRESS) {
    throw new Error('NEXT_PUBLIC_FILEVAULT_ADDRESS not set');
  }

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
 * Get vault status
 * @param {Provider} provider - Starknet provider
 * @param {string} cid - Content identifier (felt252)
 * @returns {Promise<number|null>} Status (0=Active, 1=Claimed, 2=Refunded) or null
 */
export async function getStatus(provider, cid) {
  if (!VAULT_ADDRESS) {
    throw new Error('NEXT_PUBLIC_FILEVAULT_ADDRESS not set');
  }

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
 * @param {Object} account - WalletAccountV6 instance
 * @param {string} cid - Content identifier (felt252)
 * @returns {Promise<Object>} Transaction result
 */
export async function refundVault(account, cid) {
  if (!VAULT_ADDRESS) {
    throw new Error('NEXT_PUBLIC_FILEVAULT_ADDRESS not set');
  }

  const contract = new Contract({ abi: FileVaultABI, address: VAULT_ADDRESS, providerOrAccount: account });
  const result = await contract.refund_vault(cid);
  return result;
}

/**
 * Convert CID string to felt252
 * @param {string} cid - CID string
 * @returns {string} felt252 representation
 */
export async function cidToFelt(cid) {
  const encoder = new TextEncoder();
  const data = encoder.encode(cid);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer).slice(0, 31); // felt252 = 31 bytes max
  return '0x' + Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Deploy FileVault contract to Starknet
 * @param {Object} account - WalletAccountV6 instance with declareAndDeploy capability
 * @returns {Promise<string>} Deployed contract address
 */
export async function deployContract(account) {
  if (!account) {
    throw new Error('Wallet not connected');
  }

  // Fetch the compiled contract
  const response = await fetch('/contracts/filevault.json');
  const contractClass = await response.json();

  // Declare and deploy
  const result = await account.declareAndDeploy({
    contract: contractClass,
    constructor: [],
  });

  return result.deploy.contract_address;
}

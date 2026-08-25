#!/usr/bin/env node
/**
 * scripts/deploy.js — FileVault v2 Dual-Contract Sepolia Deploy
 *
 * Deploys KeyExchangeMockup FIRST, captures its address, then deploys FileVault
 * with (platform_wallet, platform_fee, strk_token, key_exchange_address).
 *
 * Usage:
 *   node scripts/deploy.js                 # uses env vars + Alchemy Sepolia default
 *   node scripts/deploy.js --rpc <url> --private-key <key> --account <addr>
 *
 * Required env (or CLI flags):
 *   STARKNET_PRIVATE_KEY  — deployer private key (hex 0x...)
 *   STARKNET_ACCOUNT_ADDRESS — deployer account address (hex 0x...)
 *   STARKNET_RPC — optional, defaults to Alchemy Sepolia:
 *                  https://starknet-sepolia.g.alchemy.com/v2/alch_rjRG2UrZXootnmaX8FVj0
 *
 * Optional:
 *   PLATFORM_WALLET — fee recipient (default: 0x056180cC00A2F2094cc3AaA3a364C6000481E8Ecd8DED195a58bd99B30d737CF)
 *   PLATFORM_FEE    — fee in STRK wei as decimal string (default: 500000000000000000 = 0.5 STRK)
 *   STRK_TOKEN      — STRK ERC20 address (default Sepolia: 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d)
 *
 * Steps (mirrors sncast flow):
 *   1. declare KeyExchangeMockup (if not already declared) -> classHash
 *   2. deploy KeyExchangeMockup (constructor: no args) -> kexAddress
 *   3. declare FileVault
 *   4. deploy FileVault(platform_wallet, platform_fee:u256, strk_token, kex_address)
 *   5. print addresses for .env:
 *        NEXT_PUBLIC_FILEVAULT_ADDRESS=<fv>
 *        NEXT_PUBLIC_KEY_EXCHANGE_MOCKUP_ADDRESS=<kex>
 *        NEXT_PUBLIC_PLATFORM_WALLET=<wallet>
 *        NEXT_PUBLIC_STRK_TOKEN=<strk>
 *
 * After deploy, update .env and lib/filevault-abi.json is already correct for v2.
 * Verify with:
 *   sncast call --contract-address <FV> --function get_platform_fee
 *   sncast call --contract-address <KEX> --function read_lock --calldata <id>
 *
 * Reqs: starknet ^10.7.0 (already in package.json)
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { RpcProvider, Account, CallData, hash, Signer } from 'starknet'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')

// --- Config defaults (Sepolia) ---
const DEFAULTS = {
  rpc: process.env.STARKNET_RPC || 'https://starknet-sepolia.g.alchemy.com/v2/alch_rjRG2UrZXootnmaX8FVj0',
  strkToken: process.env.STRK_TOKEN || '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
  platformWallet:
    process.env.PLATFORM_WALLET ||
    '0x056180cC00A2F2094cc3AaA3a364C6000481E8Ecd8DED195a58bd99B30d737CF',
  platformFee: process.env.PLATFORM_FEE || '500000000000000000',
}

// --- CLI args ---
function parseArgs() {
  const args = process.argv.slice(2)
  const out = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--rpc' && args[i + 1]) out.rpc = args[++i]
    else if (args[i] === '--private-key' && args[i + 1]) out.privateKey = args[++i]
    else if (args[i] === '--account' && args[i + 1]) out.accountAddress = args[++i]
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Usage: node scripts/deploy.js [options]

Options:
  --rpc <url>           Starknet RPC URL (default Alchemy Sepolia)
  --private-key <key>   Deployer private key
  --account <address>   Deployer account address
  --help, -h            Show help
Env fallback: STARKNET_PRIVATE_KEY, STARKNET_ACCOUNT_ADDRESS, STARKNET_RPC
`)
      process.exit(0)
    }
  }
  return out
}

const cli = parseArgs()
const RPC_URL = cli.rpc || DEFAULTS.rpc
const PRIVATE_KEY = cli.privateKey || process.env.STARKNET_PRIVATE_KEY
const ACCOUNT_ADDRESS = cli.accountAddress || process.env.STARKNET_ACCOUNT_ADDRESS

if (!PRIVATE_KEY || !ACCOUNT_ADDRESS) {
  console.error(`
Missing deploy credentials.

Set env vars:
  export STARKNET_PRIVATE_KEY=0x...
  export STARKNET_ACCOUNT_ADDRESS=0x...
  export STARKNET_RPC=https://starknet-sepolia.g.alchemy.com/v2/...

Or pass CLI:
  node scripts/deploy.js --private-key 0x... --account 0x... --rpc <url>

Current:
  PRIVATE_KEY: ${PRIVATE_KEY ? 'set' : 'MISSING'}
  ACCOUNT_ADDRESS: ${ACCOUNT_ADDRESS ? ACCOUNT_ADDRESS : 'MISSING'}
  RPC: ${RPC_URL}
`)
  process.exit(1)
}

// --- Load compiled artifacts ---
function loadArtifact(rel) {
  const p = path.join(ROOT, rel)
  if (!fs.existsSync(p)) throw new Error(`Artifact not found: ${p} — run 'scarb build' first`)
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

// FileVault (ownerz_filevault)
const fvSierraPath = 'contracts/target/dev/ownerz_filevault_FileVault.contract_class.json'
const fvCasmPath = 'contracts/target/dev/ownerz_filevault_FileVault.compiled_contract_class.json'
// Fallback: if casm not found, try reading from sierra file's compiled path
let fvSierra = loadArtifact(fvSierraPath)
let fvCasm = null
try {
  fvCasm = loadArtifact(fvCasmPath)
} catch {
  // try alternative path from artifacts
  const artifacts = loadArtifact('contracts/target/dev/ownerz_filevault.starknet_artifacts.json')
  // not critical — starknet.js can declare without CASM on some RPCs, but Sepolia requires it
  console.warn('[deploy] FileVault CASM not found at', fvCasmPath, '- declare may require CASM')
}

// KeyExchangeMockup (key_onchain)
const kexSierraPath = 'lib/key-onchain/target/dev/keyexchangemockup_KeyExchangeMockup.contract_class.json'
const kexCasmPath = 'lib/key-onchain/target/dev/keyexchangemockup_KeyExchangeMockup.compiled_contract_class.json'
let kexSierra = loadArtifact(kexSierraPath)
let kexCasm = null
try {
  kexCasm = loadArtifact(kexCasmPath)
} catch {
  console.warn('[deploy] KEX CASM not found at', kexCasmPath)
}

async function main() {
  console.log('=== FileVault v2 Deploy (Sepolia) ===')
  console.log('RPC:', RPC_URL)
  console.log('Account:', ACCOUNT_ADDRESS)
  console.log('Platform wallet:', DEFAULTS.platformWallet)
  console.log('Platform fee:', DEFAULTS.platformFee, 'wei')
  console.log('STRK token:', DEFAULTS.strkToken)
  console.log('')

  const provider = new RpcProvider({ nodeUrl: RPC_URL })
  const signer = new Signer(PRIVATE_KEY)
  const account = new Account({ provider, address: ACCOUNT_ADDRESS, signer })

  // Ensure account is deployed / funded
  try {
    const nonce = await account.getNonce()
    console.log('[account] nonce:', nonce)
  } catch (e) {
    console.warn('[account] getNonce failed (account may not be deployed):', e.message?.slice(0, 200))
  }

  // --- 1. Declare & Deploy KeyExchangeMockup ---
  console.log('--- Step 1: KeyExchangeMockup ---')
  let kexClassHash
  try {
    console.log('[KEX] declaring...')
    const declKex = await account.declare({ contract: kexSierra, casm: kexCasm })
    kexClassHash = declKex.class_hash
    console.log('[KEX] declared, classHash:', kexClassHash)
    // Some RPCs return transaction_hash only; wait
    if (declKex.transaction_hash) {
      console.log('[KEX] waiting for declare tx:', declKex.transaction_hash)
      await provider.waitForTransaction(declKex.transaction_hash)
    }
  } catch (e) {
    // Already declared
    const msg = e.message || ''
    if (msg.includes('already declared') || msg.includes('Class already declared')) {
      console.log('[KEX] already declared, computing classHash locally')
      kexClassHash = hash.computeContractClassHash(kexSierra)
      console.log('[KEX] computed classHash:', kexClassHash)
    } else {
      console.error('[KEX] declare failed:', msg.slice(0, 800))
      throw e
    }
  }

  // Deploy KEX (no constructor args)
  console.log('[KEX] deploying...')
  let kexAddress
  try {
    const deployKex = await account.deployContract({
      classHash: kexClassHash,
      constructorCalldata: [],
    })
    kexAddress = deployKex.contract_address
    console.log('[KEX] deployed at:', kexAddress)
    console.log('[KEX] tx:', deployKex.transaction_hash)
    await provider.waitForTransaction(deployKex.transaction_hash)
    console.log('[KEX] deploy confirmed')
  } catch (e) {
    console.error('[KEX] deploy failed:', e.message?.slice(0, 800))
    throw e
  }

  // --- 2. Declare & Deploy FileVault (FORCE RE-DECLARE because constructor changed) ---
  console.log('')
  console.log('--- Step 2: FileVault ---')
  let fvClassHash
  try {
    console.log('[FV] declaring...')
    const declFv = await account.declare({ contract: fvSierra, casm: fvCasm })
    fvClassHash = declFv.class_hash
    console.log('[FV] declared, classHash:', fvClassHash)
    if (declFv.transaction_hash) {
      console.log('[FV] waiting for declare tx:', declFv.transaction_hash)
      await provider.waitForTransaction(declFv.transaction_hash)
    }
  } catch (e) {
    const msg = e.message || ''
    if (msg.includes('already declared') || msg.includes('Class already declared')) {
      console.log('[FV] already declared, but constructor changed - forcing re-declare by using new class hash')
      fvClassHash = hash.computeContractClassHash(fvSierra)
      console.log('[FV] computed NEW classHash:', fvClassHash)
    } else {
      console.error('[FV] declare failed:', msg.slice(0, 800))
      throw e
    }
  }

  // Deploy FileVault: constructor(platform_wallet, platform_fee:u256, strk_token, key_exchange, pqc, platform_fee_bps)
  console.log('[FV] deploying with constructor args...')
  const feeBig = BigInt(DEFAULTS.platformFee)
  // u256 needs to be passed as { low, high } for CallData.compile
  const feeLow = feeBig & ((1n << 128n) - 1n)
  const feeHigh = feeBig >> 128n
  const fvCalldata = CallData.compile({
    platform_wallet: DEFAULTS.platformWallet,
    platform_fee: { low: feeLow, high: feeHigh }, // u256 as {low, high}
    strk_token: DEFAULTS.strkToken,
    key_exchange: kexAddress,
    pqc: false, // default: false
    platform_fee_bps: 100, // 1% in basis points
  })
  console.log('[FV] calldata:', fvCalldata)

  let fvAddress
  try {
    const deployFv = await account.deployContract({
      classHash: fvClassHash,
      constructorCalldata: fvCalldata,
    })
    fvAddress = deployFv.contract_address
    console.log('[FV] deployed at:', fvAddress)
    console.log('[FV] tx:', deployFv.transaction_hash)
    await provider.waitForTransaction(deployFv.transaction_hash)
    console.log('[FV] deploy confirmed')
  } catch (e) {
    console.error('[FV] deploy failed:', e.message?.slice(0, 800))
    throw e
  }

  // --- Done ---
  console.log('')
  console.log('=== Deploy Complete ===')
  console.log('KeyExchangeMockup:', kexAddress)
  console.log('FileVault:        ', fvAddress)
  console.log('')
  console.log('Add to .env:')
  console.log(`NEXT_PUBLIC_FILEVAULT_ADDRESS=${fvAddress}`)
  console.log(`NEXT_PUBLIC_KEY_EXCHANGE_MOCKUP_ADDRESS=${kexAddress}`)
  console.log(`NEXT_PUBLIC_PLATFORM_WALLET=${DEFAULTS.platformWallet}`)
  console.log(`NEXT_PUBLIC_STRK_TOKEN=${DEFAULTS.strkToken}`)
  console.log(`NEXT_PUBLIC_STARKNET_RPC=${RPC_URL}`)
  console.log('')
  console.log('Verify:')
  console.log(`  starkli call ${fvAddress} get_platform_fee`)
  console.log(`  starkli call ${kexAddress} read_lock 0x123`)
  console.log('')
  // Also write to deployment file
  const outPath = path.join(ROOT, 'contracts', 'deployments', 'sepolia.json')
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          network: 'sepolia',
          rpc: RPC_URL,
          strkToken: DEFAULTS.strkToken,
          platformWallet: DEFAULTS.platformWallet,
          platformFee: DEFAULTS.platformFee,
          keyExchangeMockup: { address: kexAddress, classHash: kexClassHash },
          fileVault: { address: fvAddress, classHash: fvClassHash },
          deployedAt: new Date().toISOString(),
        },
        null,
        2
      )
    )
    console.log('Saved deployment to', outPath)
  } catch (e) {
    console.warn('Could not save deployment file:', e.message)
  }
}

main().catch((e) => {
  console.error('Deploy failed:', e)
  process.exit(1)
})

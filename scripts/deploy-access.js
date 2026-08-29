#!/usr/bin/env node
/**
 * scripts/deploy-access.js — AccessFactory + AccessToken deploy
 *
 * Deploys:
 *   1. Declare AccessToken class
 *   2. Declare AccessFactory class
 *   3. Deploy AccessFactory(class_hash, shield_pool)
 *
 * Usage:
 *   node scripts/deploy-access.js
 *   node scripts/deploy-access.js --private-key 0x... --account 0x...
 *
 * Required env (or CLI flags):
 *   STARKNET_PRIVATE_KEY  — deployer private key
 *   STARKNET_ACCOUNT_ADDRESS — deployer account address
 *   STARKNET_RPC — optional, defaults to Alchemy Sepolia
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { RpcProvider, Account, CallData, hash, Signer } from 'starknet'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')

const RPC_URL = process.env.STARKNET_RPC || 'https://starknet-sepolia.g.alchemy.com/v2/alch_rjRG2UrZXootnmaX8FVj0'
// STRK20 pool on Sepolia
const STRK20_POOL = '0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91'

// CLI args
function parseArgs() {
  const args = process.argv.slice(2)
  const out = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--private-key' && args[i + 1]) out.privateKey = args[++i]
    else if (args[i] === '--account' && args[i + 1]) out.accountAddress = args[++i]
  }
  return out
}

const cli = parseArgs()
const PRIVATE_KEY = cli.privateKey || process.env.STARKNET_PRIVATE_KEY
const ACCOUNT_ADDRESS = cli.accountAddress || process.env.STARKNET_ACCOUNT_ADDRESS

if (!PRIVATE_KEY || !ACCOUNT_ADDRESS) {
  console.error(`
Missing deploy credentials.

Set env vars:
  export STARKNET_PRIVATE_KEY=0x...
  export STARKNET_ACCOUNT_ADDRESS=0x...

Or pass CLI:
  node scripts/deploy-access.js --private-key 0x... --account 0x...
`)
  process.exit(1)
}

function loadArtifact(rel) {
  const p = path.join(ROOT, rel)
  if (!fs.existsSync(p)) throw new Error(`Artifact not found: ${p} — run 'scarb build' first`)
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

// Load artifacts
const atSierra = loadArtifact('contracts/target/dev/ownerz_filevault_AccessToken.contract_class.json')
const atCasm = loadArtifact('contracts/target/dev/ownerz_filevault_AccessToken.compiled_contract_class.json')
const afSierra = loadArtifact('contracts/target/dev/ownerz_filevault_AccessFactory.contract_class.json')
const afCasm = loadArtifact('contracts/target/dev/ownerz_filevault_AccessFactory.compiled_contract_class.json')

async function main() {
  console.log('=== AccessFactory + AccessToken Deploy (Sepolia) ===')
  console.log('RPC:', RPC_URL)
  console.log('Account:', ACCOUNT_ADDRESS)
  console.log('Shield pool:', STRK20_POOL)
  console.log('')

  const provider = new RpcProvider({ nodeUrl: RPC_URL })
  const signer = new Signer(PRIVATE_KEY)
  const account = new Account({ provider, address: ACCOUNT_ADDRESS, signer })

  // Check nonce
  const nonce = await account.getNonce()
  console.log('[account] nonce:', nonce)

  // 1. Declare AccessToken
  console.log('--- Step 1: Declare AccessToken ---')
  let atClassHash
  try {
    const decl = await account.declare({ contract: atSierra, casm: atCasm })
    atClassHash = decl.class_hash
    console.log('[AT] declared, classHash:', atClassHash)
    if (decl.transaction_hash) {
      console.log('[AT] waiting for declare tx:', decl.transaction_hash)
      await provider.waitForTransaction(decl.transaction_hash)
    }
  } catch (e) {
    if (e.message?.includes('already declared')) {
      atClassHash = hash.computeContractClassHash(atSierra)
      console.log('[AT] already declared, computed classHash:', atClassHash)
    } else {
      console.error('[AT] declare failed:', e.message?.slice(0, 500))
      throw e
    }
  }

  // 2. Declare AccessFactory
  console.log('')
  console.log('--- Step 2: Declare AccessFactory ---')
  let afClassHash
  try {
    const decl = await account.declare({ contract: afSierra, casm: afCasm })
    afClassHash = decl.class_hash
    console.log('[AF] declared, classHash:', afClassHash)
    if (decl.transaction_hash) {
      console.log('[AF] waiting for declare tx:', decl.transaction_hash)
      await provider.waitForTransaction(decl.transaction_hash)
    }
  } catch (e) {
    if (e.message?.includes('already declared')) {
      afClassHash = hash.computeContractClassHash(afSierra)
      console.log('[AF] already declared, computed classHash:', afClassHash)
    } else {
      console.error('[AF] declare failed:', e.message?.slice(0, 500))
      throw e
    }
  }

  // 3. Deploy AccessFactory(class_hash, shield_pool)
  console.log('')
  console.log('--- Step 3: Deploy AccessFactory ---')
  // Pass constructor args as flat array: [access_token_class_hash, shield_pool]
  const calldata = [atClassHash, STRK20_POOL]
  console.log('[AF] calldata:', calldata)

  try {
    const deploy = await account.deployContract({
      classHash: afClassHash,
      constructorCalldata: calldata,
    })
    const afAddress = deploy.contract_address
    console.log('[AF] deployed at:', afAddress)
    console.log('[AF] tx:', deploy.transaction_hash)
    await provider.waitForTransaction(deploy.transaction_hash)
    console.log('[AF] deploy confirmed')

    console.log('')
    console.log('=== Deploy Complete ===')
    console.log('AccessFactory:', afAddress)
    console.log('AccessToken classHash:', atClassHash)
    console.log('')
    console.log('Add to .env:')
    console.log(`NEXT_PUBLIC_ACCESS_FACTORY_ADDRESS=${afAddress}`)
    console.log('')
    console.log('Create your first token via the frontend or:')
    console.log(`  sncast invoke --contract-address ${afAddress} --function create_token --calldata <name> <symbol> <price_low> <price_high> <duration>`)

    // Save deployment
    const outPath = path.join(ROOT, 'contracts', 'deployments', 'access-sepolia.json')
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, JSON.stringify({
      network: 'sepolia',
      rpc: RPC_URL,
      shieldPool: STRK20_POOL,
      accessToken: { classHash: atClassHash },
      accessFactory: { address: afAddress, classHash: afClassHash },
      deployedAt: new Date().toISOString(),
    }, null, 2))
    console.log('Saved deployment to', outPath)
  } catch (e) {
    console.error('[AF] deploy failed:', e.message?.slice(0, 500))
    throw e
  }
}

main().catch(e => {
  console.error('Deploy failed:', e)
  process.exit(1)
})

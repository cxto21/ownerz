/**
 * Dual-contract deploy helper for browser (DeploySection)
 *
 * Full production deploy uses Node script: scripts/deploy.js
 * This file provides a thin browser wrapper that calls scripts via wallet.
 *
 * For now, DeploySection will use this to attempt dual deploy via wallet.
 * If browser declare fails, it instructs user to use scripts/deploy.js with sncast/starknet.js Node.
 */

import { RpcProvider } from 'starknet'

// RPC for reads
const RPC_URL =
  process.env.NEXT_PUBLIC_STARKNET_RPC ||
  'https://starknet-sepolia.public.blastapi.io/rpc/v0_8'

/**
 * Deploy both contracts via browser wallet (requires wallet to support declare & deploy).
 * Falls back to instructions for Node deploy script.
 * @param {Object} account - WalletAccount
 * @returns {Promise<string>} FileVault address
 */
export async function deployDual(account) {
  if (!account) throw new Error('Wallet not connected')

  // We cannot declare Sierra/CASM from browser without compiled artifacts fetched.
  // Best effort: try to fetch compiled artifacts if present, otherwise instruct.
  throw new Error(
    'Browser dual-deploy not implemented for FileVault v2. Use scripts/deploy.js:\n' +
      '  $ node scripts/deploy.js --network sepolia\n' +
      'Or with starkli/sncast:\n' +
      '  $ sncast declare --contract-name KeyExchangeMockup\n' +
      '  $ sncast deploy --class-hash <KEX_HASH> \n' +
      '  $ sncast declare --contract-name FileVault\n' +
      '  $ sncast deploy --class-hash <FV_HASH> --constructor-args ' +
      '<platform_wallet> <platform_fee_low> <platform_fee_high> <strk_token> <kex_address>\n' +
      'See scripts/deploy.js for full steps.'
  )
}

export default deployDual

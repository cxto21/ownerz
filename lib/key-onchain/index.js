// lib/key-onchain/index.js
// Key Onchain — Public API (MOCKUP v0)
// Re-exports from Ownerz configuration + local generate/recover

import { generateListing } from './generate.js'
import { recoverListing } from './recover.js'
import {
  lock,
  unlock,
  readLock,
  getFee,
  deploy,
  computeCommitment,
  verifyCommitment,
  secretToOnChain,
  computeIntegrityHash,
  identifierToFelt,
  stringToFelt,
  feltToString,
} from '../ownerz/key-onchain-config.js'

export {
  generateListing,
  recoverListing,
  lock,
  unlock,
  readLock,
  getFee,
  deploy,
  computeCommitment,
  verifyCommitment,
  secretToOnChain,
  computeIntegrityHash,
  identifierToFelt,
  stringToFelt,
  feltToString,
}

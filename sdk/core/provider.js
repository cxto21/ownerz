// DataVaultz SDK — Starknet RPC provider factory (isomorphic, no window access).
import { RpcProvider } from 'starknet'
import { config } from './config'

let _readProvider = null

// Returns a cached read-only RpcProvider bound to the configured RPC URL.
export function getReadProvider() {
  if (!_readProvider) {
    _readProvider = new RpcProvider({ nodeUrl: config.rpcUrl })
  }
  return _readProvider
}

// Alias for callers that prefer an explicit factory name.
export function createReadProvider() {
  return getReadProvider()
}

export { RpcProvider }

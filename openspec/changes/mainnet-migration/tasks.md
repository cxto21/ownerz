# Tasks: Starknet Mainnet Migration

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~170 (60 new + 110 modified) |
| 400-line budget risk | Low |
| Chained PRs recommended | Yes |
| Suggested split | PR1: Config → PR2: Code consumers → PR3: Tooling |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Network config module + env docs | PR 1 | `node -e "import('./lib/network-config.js').then(m => { process.env.NEXT_PUBLIC_NETWORK='SN_MAIN'; console.log(m.getNetworkConfig()); })"` | Node script, no browser | Revert 2 files |
| 2 | All consumer lib files + pages/index.js | PR 2 | `npm run build` with `NEXT_PUBLIC_NETWORK=SN_MAIN` | Full Next.js build | Revert 8 files |
| 3 | Deploy script + snfoundry + next.config | PR 3 | `node scripts/deploy.js --help` shows `--network mainnet` | Deploy dry-run | Revert 3 files |

## Phase 1: Config Foundation

- [x] 1.1 Create `lib/network-config.js` (~60 lines): `NETWORKS` map for SN_MAIN/SN_SEPOLIA, `getNetworkConfig()` with cache, env fallback, console.warn on unknown value. Export: `chainIdHex`, `chainLabel`, `explorerBase`, `kitChainId`, `rpcFallback`, `strk20PoolAddress`, `strkTokenAddress`.
- [x] 1.2 Update `.env.example`: add `NEXT_PUBLIC_NETWORK` section (mainnet example + unset dev default), mainnet RPC placeholder, document unset = Sepolia.

## Phase 2: Consumer Code Updates

- [x] 2.1 `lib/starknet.js` lines 24-26: import `getNetworkConfig`, replace hardcoded RPC_URL fallback with `{ rpcFallback: RPC_URL }`.
- [x] 2.2 `lib/filevault.js` lines 20-22: same pattern — import and destructure `rpcFallback`.
- [x] 2.3 `lib/strk20-payments.js` lines 14-20 + 475: replace hardcoded pool/STRK addresses with `_net.strk20PoolAddress` / `_net.strkTokenAddress`; line 475 replace `sepolia.voyager.online` with `getNetworkConfig().explorerBase`.
- [x] 2.4 `lib/starknet-kit.js` lines 92, 102: import config, replace `process.env.NEXT_PUBLIC_STARKNET_RPC || undefined` with `rpcFallback`, replace `'SN_SEPOLIA'` with `kitChainId`.
- [x] 2.5 `pages/index.js` lines 86-96: import config, replace hardcoded provider URL + chainId hex `5345504f4c4941` + error msg with dynamic `net.chainIdHex` / `net.chainLabel`.
- [x] 2.6 `lib/ownerz/key-onchain-config.js` lines 11-13: replace hardcoded RPC_URL fallback with `getNetworkConfig().rpcFallback`.
- [x] 2.7 `lib/key-onchain/mockup/deploy.js` lines 14-16: same RPC fallback replacement.
- [x] 2.8 `lib/key-onchain/mockup/key-exchange-provider.js` lines 21-23: replace `DEFAULT_RPC` with `getNetworkConfig().rpcFallback`.

## Phase 3: Tooling Updates

- [ ] 3.1 `next.config.js` lines 8-9: ternary on `process.env.NEXT_PUBLIC_NETWORK === 'SN_MAIN'` for Alchemy mainnet vs Sepolia RPC base URL.
- [ ] 3.2 `contracts/snfoundry.toml`: add `[sncast.mainnet]` section with mainnet Alchemy RPC placeholder. Default stays Sepolia.
- [ ] 3.3 `scripts/deploy.js`: add `--network` CLI arg (default: sepolia). When mainnet: override DEFAULTS.rpc to mainnet BlastAPI, verify chainId before declare, write `contracts/deployments/mainnet.json`, print mainnet `.env` values.

## Phase 4: Documentation & Cross-reference

- [ ] 4.1 `openspec/changes/wallet-data-linking/proposal.md`: add note that mainnet chainId is `SN_MAIN` / `0x534e5f4d41494e`.

## Phase 5: Verification

- [ ] 5.1 `npm run build` with `NEXT_PUBLIC_NETWORK=SN_MAIN` + mainnet RPC env — must pass with zero errors.
- [ ] 5.2 `npm run build` with `NEXT_PUBLIC_NETWORK` unset — Sepolia regression check, must pass identically.
- [ ] 5.3 `node -e` unit test: `getNetworkConfig()` returns correct values for SN_MAIN, SN_SEPOLIA, unset, and unknown value.
- [ ] 5.4 `node scripts/deploy.js --help` — verify `--network mainnet` appears in usage.
- [ ] 5.5 Verify `contracts/deployments/mainnet.json` is NOT created by build/test — only by explicit deploy.

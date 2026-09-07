# Proposal: Starknet Mainnet Migration

## Intent

Ownerz runs entirely on Starknet Sepolia (contracts, STRK20 pool, explorer links). Sepolia is dev-only; this change moves Ownerz to Mainnet for real listings and real STRK payments. Contracts are chain-agnostic — no Cairo changes. Work is mechanical: config + env + ~15 small JS edits, gated behind `NEXT_PUBLIC_NETWORK=SN_MAIN`.

## Scope

### In Scope
- `NEXT_PUBLIC_NETWORK=SN_MAIN` driving chainId check, explorer URL, Kit chainId, RPC fallback, pool address
- Mainnet pool `0x040337b1…812a` (verify on Voyager first); STRK token unchanged (same address)
- Mainnet RPC fallbacks: `lib/starknet.js`, `lib/filevault.js`, `lib/starknet-kit.js`, `lib/key-onchain/mockup/` (2 files), `lib/ownerz/key-onchain-config.js`
- `pages/index.js` chainId check → SN_MAIN hex + error msg; explorer → `voyager.online`
- `next.config.js` /api/rpc rewrite + `contracts/snfoundry.toml` → mainnet
- `scripts/deploy.js` `--network mainnet` → `contracts/deployments/mainnet.json`
- `.env.example` mainnet vars + `wallet-data-linking` proposal chainId note

### Out of Scope
- AVNU Paymaster (separate follow-up; PaymasterRpc already in starknet@10.7.1)
- Any Cairo/contract changes
- Runtime multi-network switching (env-driven per deploy)
- Sepolia vault state migration (clean start)

## Capabilities

### New Capabilities
- `starknet-network-config`: env-driven network selection deriving chainId, explorer URL, Kit chainId, RPC fallback, pool address; runs on SN_MAIN.

### Modified Capabilities
- None (`frontend-branding` untouched)

## Approach

1. **Config first**: `.env.example`/`.env` — `NEXT_PUBLIC_NETWORK=SN_MAIN`, mainnet RPC, contract addresses, platform wallet; verify pool address on Voyager.
2. **Code**: network-derivation helper; swap pool/explorer/chainId/RPC fallbacks across 6 lib files, `pages/index.js`, `next.config.js`, `snfoundry.toml`.
3. **Deploy**: fund deployer → `scripts/deploy.js --network mainnet` → `mainnet.json` → update `.env` → deploy Pages → smoke test (connect, shield, private op).

## Affected Areas

| Area | Impact |
|---|---|
| `lib/strk20-payments.js` | Pool + explorer URL |
| 6 lib files | RPC fallback → mainnet |
| `pages/index.js` | ChainId check + error msg |
| `next.config.js`, `snfoundry.toml` | RPC rewrite |
| `scripts/deploy.js` | mainnet mode + record |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| ~4 STRK pool fee/private op breaks low-price pricing | High | Fee in UI estimates; AVNU sponsored_private follow-up |
| Platform wallet must be mainnet-controlled | High | New wallet verified pre-deploy; never reuse Sepolia |
| Wrong pool address hardcoded | Med | Voyager check pre-merge |
| Gas STRK-only (v0.14+) | Med | Fund deployer; document gas needs |
| Vault state lost (no migration) | High | Announce clean start; Sepolia config retained |

## Rollback Plan

Config-driven: `git revert` the ~15 edits, restore `.env` (Sepolia addresses, `NEXT_PUBLIC_NETWORK` unset), redeploy. Mainnet contracts stay deployed harmlessly; Sepolia untouched.

## Dependencies

- Mainnet RPC (Alchemy/BlastAPI), mainnet STRK for deployer fees, mainnet-controlled platform wallet, verified pool address. No new npm deps.

## Success Criteria

- [ ] Build passes; mainnet-env frontend completes a private STRK20 op end-to-end on SN_MAIN
- [ ] ChainId check passes for SN_MAIN hex; wrong-network error shown otherwise
- [ ] Contracts deployed on mainnet; `mainnet.json` written; `.env` points to real addresses
- [ ] Explorer links use `voyager.online`; Kit chainId `SN_MAIN`
- [ ] 4 STRK fee reflected in UI estimates
- [ ] Sepolia still works with `NEXT_PUBLIC_NETWORK` unset
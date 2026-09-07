# starknet-network-config Specification

## Purpose

Env-driven Starknet network selection: `NEXT_PUBLIC_NETWORK=SN_MAIN` derives mainnet chainId, explorer URL, Kit chainId, RPC fallbacks, and STRK20 pool address across the frontend, `/api/rpc` rewrite, deploy tooling, and contracts tooling. Unset keeps Sepolia behavior. No Cairo changes; runtime network switching is out of scope.

## Requirements

### Requirement: Network derivation module

The system SHALL provide a single network-config module deriving from `NEXT_PUBLIC_NETWORK`: expected chainId hex, chain label, explorer base URL, Kit chainId, RPC fallback URL, and STRK20 pool address. `SN_MAIN` MUST map to mainnet; unset or `SN_SEPOLIA` MUST map to Sepolia; other values MUST NOT activate mainnet and SHALL fall back to Sepolia with a console warning.

#### Scenario: mainnet config

- GIVEN `NEXT_PUBLIC_NETWORK=SN_MAIN`
- WHEN a module reads derived values
- THEN chainId is mainnet, Kit chainId is `SN_MAIN`, explorer is `https://voyager.online`, pool is `0x040337b1…812a`, RPC fallback is mainnet BlastAPI

#### Scenario: Sepolia default

- GIVEN `NEXT_PUBLIC_NETWORK` unset or `SN_SEPOLIA`
- WHEN a module reads derived values
- THEN values match today: `sepolia.voyager.online`, `SN_SEPOLIA`, pool `0x0254a6b2…0d91`, BlastAPI Sepolia

#### Scenario: unknown value

- GIVEN `NEXT_PUBLIC_NETWORK=SN_GOERLI`
- WHEN the config loads
- THEN mainnet is not used, Sepolia values apply, and a console warning names the invalid value

### Requirement: Per-network RPC fallback

RPC fallback constants MUST resolve through the network config in `lib/starknet.js`, `lib/filevault.js`, `lib/ownerz/key-onchain-config.js`, `lib/key-onchain/mockup/deploy.js`, `lib/key-onchain/mockup/key-exchange-provider.js`, and the chainId-check provider in `pages/index.js`. The `/api/rpc` rewrite in `next.config.js`, `contracts/snfoundry.toml`, and Kit connector RPC/chainId in `lib/starknet-kit.js` SHALL target mainnet when `SN_MAIN`.

#### Scenario: fallback resolves to mainnet

- GIVEN `SN_MAIN` and no `NEXT_PUBLIC_STARKNET_RPC`
- WHEN a provider is created
- THEN it targets BlastAPI mainnet (libs) / Alchemy mainnet (`/api/rpc` rewrite)

#### Scenario: env RPC wins

- GIVEN `SN_MAIN` and `NEXT_PUBLIC_STARKNET_RPC` set to a mainnet URL
- WHEN a provider is created
- THEN the env URL is used, never the fallback

#### Scenario: Sepolia regression

- GIVEN `NEXT_PUBLIC_NETWORK` unset
- WHEN the app builds and runs
- THEN every provider targets the Sepolia defaults exactly as before

### Requirement: Mainnet contract deployment

`scripts/deploy.js` MUST accept `--network mainnet`, verify the RPC chainId matches the requested network, deploy KeyExchangeMockup then FileVault, and write `contracts/deployments/mainnet.json` (network, addresses, class hashes, rpc, platformWallet, platformFee, strkToken, deployedAt). It MUST NOT overwrite `sepolia.json`.

#### Scenario: successful mainnet deploy

- GIVEN `--network mainnet`, a funded mainnet deployer, and a mainnet RPC
- WHEN the script runs
- THEN both contracts deploy, `mainnet.json` is written, and `.env` values print

#### Scenario: network mismatch

- GIVEN `--network mainnet` against a Sepolia RPC (or the reverse)
- WHEN the script runs
- THEN it fails before declaring, naming the mismatch

#### Scenario: record unwritable

- GIVEN `contracts/deployments/` is read-only
- WHEN the deploy completes
- THEN addresses still print with a warning that `mainnet.json` was not written

### Requirement: ChainId enforcement and explorer links

When `SN_MAIN`, `pages/index.js` SHALL compare the wallet chainId against the mainnet hex and, on mismatch, show "Please switch to Starknet Mainnet". Transaction links SHALL use the derived explorer URL (`voyager.online/tx/…` mainnet, `sepolia.voyager.online/tx/…` Sepolia).

#### Scenario: correct network

- GIVEN a wallet on mainnet and `SN_MAIN`
- WHEN the network check runs
- THEN no error is shown and flows proceed

#### Scenario: wrong network

- GIVEN a wallet on Sepolia and `SN_MAIN`
- WHEN the network check runs
- THEN the error names "Starknet Mainnet"

#### Scenario: explorer link

- GIVEN a completed tx on mainnet
- WHEN the user opens the tx link
- THEN it points to `https://voyager.online/tx/<hash>`

### Requirement: Mainnet STRK20 pool and fee display

The mainnet pool SHALL be `0x040337b1…812a` (verified on Voyager before merge) and SHALL be used for shield/transfer/withdraw when `SN_MAIN`. UI cost estimates SHALL include the ~4 STRK per-op pool fee and SHALL warn when it exceeds the listing price.

#### Scenario: pool address verified

- GIVEN the configured mainnet pool address
- WHEN checked against Voyager before release
- THEN it matches `0x040337b1…812a`; a mismatch blocks the merge

#### Scenario: fee in estimate

- GIVEN a listing on mainnet
- WHEN the seller previews costs
- THEN the estimate shows a ~4 STRK pool fee line

#### Scenario: fee exceeds price

- GIVEN a mainnet listing priced below ~4 STRK
- WHEN the estimate renders
- THEN a warning states the pool fee exceeds the listing price

### Requirement: Environment variable contract

`.env.example` MUST document `NEXT_PUBLIC_NETWORK` (mainnet example plus unset dev default) and mainnet values for `NEXT_PUBLIC_STARKNET_RPC`, `NEXT_PUBLIC_FILEVAULT_ADDRESS`, `NEXT_PUBLIC_KEY_EXCHANGE_MOCKUP_ADDRESS`, `NEXT_PUBLIC_PLATFORM_WALLET`, `NEXT_PUBLIC_STRK_TOKEN`, and `NEXT_PUBLIC_STRK20_POOL_ADDRESS`. The `wallet-data-linking` proposal SHALL note the mainnet chainId.

#### Scenario: documented switch

- GIVEN a fresh clone with `.env` copied from `.env.example`
- WHEN `NEXT_PUBLIC_NETWORK=SN_MAIN` is set with real mainnet addresses
- THEN the build passes and the app derives mainnet values

#### Scenario: missing network var

- GIVEN no `NEXT_PUBLIC_NETWORK`
- WHEN the app runs
- THEN it behaves as Sepolia and never references the mainnet pool
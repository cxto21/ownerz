# DataVaultz AGENTS

Project-specific instructions for this repo. See also global `~/.config/opencode/AGENTS.md` for persona and Engram protocol.

## Local Dev Setup (reproducible)

### Prerequisites
- Node.js `>=18` (tested with `v22.23.2`)
- npm `>=9`
- Starknet wallet: [Ready extension](https://ready.app/) (desktop) or mobile via StarknetKit QR

### First-time setup
```bash
# Clone and install
git clone <repo-url> && cd DataVaultz
npm install --legacy-peer-deps    # --legacy-peer-deps required (starknetkit peer expects starknet@^8, we use ^10)

# Environment
cp .env.example .env
# Required keys in .env:
#   NEXT_PUBLIC_STARKNET_RPC        — Alchemy/BlastAPI Sepolia RPC
#   NEXT_PUBLIC_FILEVAULT_ADDRESS   — deployed FileVault contract
#   NEXT_PUBLIC_KEY_EXCHANGE_MOCKUP_ADDRESS — deployed KEX contract
#   NEXT_PUBLIC_PLATFORM_WALLET     — fee recipient address
#   FIL_ONE_ENDPOINT / FIL_ONE_ACCESS_KEY_ID / FIL_ONE_SECRET_ACCESS_KEY / FIL_ONE_BUCKET — storage
#   NEXT_PUBLIC_WC_PROJECT_ID       — WalletConnect Cloud project (for mobile QR)

# Run dev server
npm run dev    # → http://localhost:3001
```

### Port and scripts
| Script | Command | Port |
|---|---|---|
| `npm run dev` | `next dev -p 3001` | 3001 |
| `npm run build` | `next build` | — |
| `npm run pages:build` | `npx @cloudflare/next-on-pages` | — |
| `npm run pages:deploy` | `npx wrangler pages deploy .vercel/output/static` | — |

### Troubleshooting local dev
- **`next: not found`** — run `npm install --legacy-peer-deps` again
- **`Cannot find module '@swc/helpers'`** — `rm -rf node_modules && npm install --legacy-peer-deps`
- **Port 3001 in use** — `lsof -i :3001 -t | xargs kill -9` then `npm run dev`
- **starknetkit SSR crash** — never import `starknetkit` at top level; always dynamic `import()` inside functions
- **WalletConnect QR fails** — ensure `NEXT_PUBLIC_WC_PROJECT_ID` is set in `.env`

### Dependency notes
- `starknetkit@3.4.3` peer expects `starknet@^8.0.0` but we use `starknet@10.7.0` — use `--legacy-peer-deps` on every install
- `@starknet-io/get-starknet-discovery` is a direct import in `lib/starknet.js:15` — do not remove
- `@starknet-io/types-js` and `@starknet-io/get-starknet-wallet-standard` are NOT top-level deps — they are transitive via `starknetkit` and `get-starknet-discovery`
- `process` polyfill is NOT needed — Next.js 14 provides it
- `playwright` is NOT used in any source file — not in deps

## StarknetKit Mobile (pending review)

> **Status:** Implemented locally, NOT pushed to `main` — awaiting user review. Run `git status` / `git diff` to inspect before pushing.

### Why
Mobile browsers cannot install the Ready/Argent X desktop extensions, so the legacy `getAvailableWallets() → "Install Ready"` flow was a dead-end on phones. StarknetKit + WalletConnect (QR / deeplink) lets iOS Safari / Android Chrome connect to Ready/Argent mobile apps.

### What was changed
- **Installed** `starknetkit@3.4.3` with `--legacy-peer-deps` (peer expects `starknet@^8.0.0`, we keep `starknet@10.7.0` for `WalletAccountV6`).
  - `package.json` updated.
- **Created** `lib/starknet-kit.js` (~80 lines) — thin wrapper, no STRK20 logic:
  - Dynamic `import('starknetkit')`, `import('starknetkit/injected')`, `import('starknetkit/argentMobile')` inside functions (SSR-safe, avoids 2.5 MB server bundle).
  - `export async function connectViaKit({ modalMode="alwaysAsk", modalTheme="system" })` → builds connectors `[ ArgentMobileConnector.init({ dappName:"Ownerz DataVaultz", url: window.location.hostname, chainId:"SN_SEPOLIA", rpcUrl: NEXT_PUBLIC_STARKNET_RPC, projectId: NEXT_PUBLIC_WC_PROJECT_ID }), new InjectedConnector({id:"argentX"}), new InjectedConnector({id:"braavos"}) ]` and calls `skConnect`. Returns `wallet` (`StarknetWindowObject`) or `null`.
  - `export async function isInReadyAppBrowser()` (tries `starknetkit/argentMobile` helper, falls back to UA sniff) + `export function isMobileBrowser()` (sync `/Mobi|Android/` + `matchMedia`).
  - No top-level `window` access; guards with `typeof window`.
- **Updated** `pages/index.js`:
  - Stores `wallet` in `walletState` (needed for `refreshWallet` after Kit connect).
  - `handleConnect`: detects mobile (`/Mobi|Android/` or `max-width:768px`), tries `connectViaKit()` first when mobile or no injected wallets; on success passes Kit wallet to existing `connectWallet(wallet)` (which does `WalletAccountV6.connect` + `isStrk20Capable`). Fallback keeps desktop `getAvailableWallets()[0]` flow. Does NOT use `kit.wallet.account` directly — STRK20 stays in `lib/starknet.js`.
  - Added `handleConnectViaKit` (QR button) + `handleOpenInReadyApp` (deeplink `https://ready.co/app?url=...`).
  - Error handling: after 15 s `waitForWallets` timeout now sets `"No wallet detected. On mobile, use 'Connect via QR' …"` and error banner renders two buttons when `isNoWalletError`: **Connect via QR** (`handleConnectViaKit`) and **Open in Ready App** (deeplink).
  - `refreshWallet(preferredWallet?)` now reuses `walletState.wallet` or explicit param before falling back to discovery; compatible with Kit wallets.
  - `useEffect` mount still does `waitForWallets(5,500)` fallback to Kit via `handleConnect` after 15 s.
- **Updated** `.env.example` — added `NEXT_PUBLIC_WC_PROJECT_ID=YOUR_WALLETCONNECT_PROJECT_ID` (WalletConnect Cloud).
- **Kept** `lib/starknet.js` untouched as transaction layer (still exports `getAvailableWallets`, `waitForWallets`, `onWalletInjected`, `connectWallet`, `resolvePrivacyWallet`, `strk20InvokeViaWalletApi`, etc.).

### Env required
```bash
NEXT_PUBLIC_WC_PROJECT_ID=YOUR_WALLETCONNECT_PROJECT_ID
# create at https://cloud.walletconnect.com — StarknetKit's ReadyConnector (= ArgentMobileConnector) pulls @walletconnect/sign-client
```
Without it QR/WalletConnect still opens but pairing will fail; desktop injected flow unaffected. Add to `.env` (ignored by git) — `.env.example` now documents placeholder.

### How to test (client-only)
```bash
npm run build   # must pass — verifies SSR guard (starknetkit is dynamically imported)
npm run dev     # then open http://localhost:3001
```
- **Desktop Chrome + Ready X**: click CONNECT → should still use injected wallet (no modal). If no wallet, modal shows Ready/ArgentX/Braavos.
- **iOS Safari**: open dev URL → after 15 s should see "No wallet detected" + **Connect via QR** → tap → StarknetKit modal with QR → scan with Ready mobile app → WalletConnect pairs → STRK20 flow unchanged (`lib/starknet.js` `WalletAccountV6`).
- **Android Chrome / in-app (Ready mobile)**: `isInReadyAppBrowser()` path; CONNECT should deeplink/QR to Ready; `Open in Ready App` button opens `ready.co/app?url=…`.
- **STRK20 sanity**: connect → Shield → `strk20InvokeTransaction` via `walletV6.requestAccounts` / `supportedWalletApi` / `WalletAccountV6` — unchanged.
- **Cairo**: `scarb build` / `snforge test` still pass (unrelated, no contract changes).

### Constraints respected
- No `git push` to remote `main` (local changes only).
- No `~/ownerz-desktop` touched.
- `.env` stays ignored; only `.env.example` committed with placeholder.

### Gotchas
- `starknetkit` peer `starknet@^8` vs our `starknet@10.7.0`: use `--legacy-peer-deps` on installs; do not downgrade.
- Kit modal is client-only — never import `starknetkit` at top level without `typeof window` guard; current wrapper uses dynamic import.

## Cloudflare Infrastructure (planned)

> **Status:** Proposal written in `openspec/changes/wallet-data-linking/proposal.md`. Not yet implemented.

### Stack
- **Storage:** Cloudflare R2 (primary, 0 egress, PQ via edge) + IPFS/Filecoin (cold, CIDv1 content-addressed)
- **Database:** Cloudflare D1 (users, nonces, vaults_meta, api_keys)
- **Auth:** SIWS (Sign-In With Starknet) JWT via Cloudflare Workers + D1
- **Compute (roadmap):** TEE CoCo (Confidential Containers) — compute-to-data, attestation on-chain
- **Agents (roadmap):** OpenSea Tools listing — private payments + TEE compute for IA agents

### Key files
| File | Purpose |
|---|---|
| `pages/index.js` | Main UI (SellFlow/BuyFlow tabs) |
| `lib/starknet.js` | Wallet connection + STRK20 payments |
| `lib/starknet-kit.js` | Mobile QR connect (StarknetKit) |
| `lib/s3.js` | S3 client (currently Fil One, planned: R2) |
| `lib/storage/index.js` | Storage port (upload/download key seeds + files) |
| `lib/crypto/index.js` | ML-KEM768 + AES-256-GCM (post-quantum encryption) |
| `lib/filevault.js` | FileVault contract interaction |
| `lib/key-onchain/` | Key exchange + commitment layer |
| `pages/api/upload.js` | Edge upload handler (runtime: edge) |
| `pages/api/download.js` | Edge download handler (runtime: edge) |
| `contracts/src/filevault.cairo` | Cairo smart contract |
| `openspec/changes/wallet-data-linking/proposal.md` | Step 1 proposal (wallet-to-data linking) |

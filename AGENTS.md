# DataVaultz AGENTS

Project-specific instructions for this repo. See also global `~/.config/opencode/AGENTS.md` for persona and Engram protocol.

## StarknetKit Mobile (pending review)

> **Status:** Implemented locally, NOT pushed to `main` — awaiting user review. Run `git status` / `git diff` to inspect before pushing.

### Why
Mobile browsers cannot install the Ready/Argent X desktop extensions, so the legacy `getAvailableWallets() → "Install Ready"` flow was a dead-end on phones. StarknetKit + WalletConnect (QR / deeplink) lets iOS Safari / Android Chrome connect to Ready/Argent mobile apps.

### What was changed
- **Installed** `starknetkit@3.4.3` with `--legacy-peer-deps` (peer expects `starknet@^8.0.0`, we keep `starknet@10.7.0` for `WalletAccountV6`). Expect duplicate `node_modules/@starknet-io/types-js` (`0.10.3` top-level + `0.8.4` under `starknetkit`) — intentional, does not break `WalletAccountV6`.
  - `package.json` + `package-lock.json` updated.
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
- `@starknet-io/types-js` duplicate is expected; `WalletAccountV6` from `starknet@10.7.0` remains primary.
- Kit modal is client-only — never import `starknetkit` at top level without `typeof window` guard; current wrapper uses dynamic import.

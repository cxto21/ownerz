# STRK20 Privacy Integration Plan — Ownerz

Generated 2026-08-14 by the strk20-privacy-integration skill. Statuses below were current at generation time — re-verify the "coming soon" items before building against them.

## 1. Project snapshot

- Stack: Next.js 14, React 18, no Starknet packages yet (greenfield integration)
- Relevant code: `pages/index.js` (UI + wallet mock), `pages/api/upload.js`, `pages/api/download.js`, `lib/encryption.js`
- Privacy goal (from interview): **Hide who pays whom in data marketplace transactions. Buyer pays STRK20 privately to access encrypted data; seller receives payment without public link between buyer and purchase.**
- Environment: Mainnet target, users hold Braavos/Argent (need to migrate to Ready for STRK20)

## 2. Chosen route: Privacy Wallet API via starknet.js

Normal dapp route — users connect their own privacy-enabled wallet (Ready extension). The dapp asks the wallet to perform shield/unshield/private transfers; the wallet handles keys, notes, proving, and the pool. The dapp never touches viewing keys.

**The rule this follows:** this app never touches viewing keys — the user's wallet acts on its behalf via starknet.js.

## 3. What this delivers — hidden vs visible

| Private (inside the pool) | Public (onchain) |
|---|---|
| Buyer's identity in the payment | Deposit/withdrawal amounts (ERC-20 legs) |
| Payment amount between buyer and seller | Fact that an address interacted with the pool |
| Which notes were spent | Timing of pool interactions |

**Limits:** Deposit and withdrawal amounts remain public (they're the ERC-20 legs). The pool interaction itself is visible — only the participants and amounts inside the pool are hidden.

## 4. Prerequisites & versions

- `starknet@10.4.0` (or later 10.5.x)
- `@starknet-io/get-starknet-discovery@6.0.3`
- `@starknet-io/get-starknet-wallet-standard@6.0.3`
- `@starknet-io/types-js@0.10.3`
- Test wallet: Ready extension (Braavos/Argent do NOT support STRK20 yet)
- Alchemy RPC: `https://starknet-mainnet.g.alchemy.com/v2/<KEY>`

## 5. Phase 1 — Wallet Connection + First Shielded Payment (buildable now)

**Goal:** User connects Ready wallet, pays privately with STRK20 to access encrypted data.

1. **Install Starknet packages** in `package.json`:
   - `starknet@10.4.0`
   - `@starknet-io/get-starknet-discovery@6.0.3`
   - `@starknet-io/get-starknet-wallet-standard@6.0.3`
   - `@starknet-io/types-js@0.10.3`

2. **Create `lib/starknet.js`** — wallet connection module:
   - Initialize get-starknet v6 discovery
   - Export `connectWallet()` function
   - Export `getWalletAccount()` to get `WalletAccountV6`
   - Detect STRK20 capability via `supportedWalletApi()`
   - Handle no-privacy-wallet case (show "Install Ready extension")

3. **Update `pages/index.js`** — replace mock wallet with real connection:
   - Import `connectWallet` from `lib/starknet.js`
   - On connect: call `connectWallet()`, get account
   - Display connected address (truncated)
   - Show STRK20 capability status

4. **Create `lib/strk20-payments.js`** — payment module:
   - `shieldTokens(account, tokenAddress, amount)` — deposit STRK into pool
   - `privateTransfer(account, recipientNote, amount)` — send privately
   - `unshieldTokens(account, amount)` — withdraw to public balance
   - Read pool fee from contract (`get_fee_amount`)
   - Handle two-transaction deposit (approve + deposit)

5. **Wire payment flow** in `pages/index.js`:
   - BuyFlow: after CID input, prompt "Pay with STRK20 privately"
   - Call `privateTransfer()` to pay seller
   - On success: reveal decryption key (future: auto-reveal on-chain)
   - Show transaction status (submitted → confirmed)

6. **Graceful degradation**:
   - Detect if wallet supports STRK20
   - If not: show "Install Ready extension for private payments"
   - If wallet not installed: show "Connect wallet" with link to Ready

7. **Verify** against Ready extension + wallet test dapp

## 6. Phase 2 — Full Marketplace Flow

**Goal:** Complete buy/sell flow with real STRK20 payments.

1. **Seller flow**:
   - Connect wallet → upload encrypted file → set price in STRK
   - Register CID + price in smart contract (future: Cairo contract)
   - Share CID privately with buyer

2. **Buyer flow**:
   - Enter CID → see price → pay privately via STRK20
   - Payment triggers decryption key reveal
   - Download + decrypt file

3. **Smart contract** (Cairo):
   - Store CID → price mapping
   - On payment: emit event with decryption key
   - Handle refunds, disputes (future)

4. **Fee UX**:
   - Show pool fee before confirmation
   - Subtract fee when pre-filling max amount
   - Handle fee payment (currently wallet-sponsored gas, not pool fees)

## 7. Phase 3 — Key Management (planned, after Phase 2)

**Goal:** Decryption key revealed automatically on purchase, not shared manually.

**This is the next major phase after wallet + STRK20 integration.**

- Decryption key stored encrypted in smart contract
- On successful STRK20 payment, key revealed to buyer via private event
- Seller never shares key manually
- Key rotation, recovery mechanisms
- Integration with post-quantum encryption (ML-KEM768)

**Entry criteria:** Phase 2 complete, STRK20 payments working on testnet.

## 8. Testing

- Testnet-first (Sepolia)
- Ready extension for wallet interactions
- Wallet test dapp: https://starknet-wallet-account.vercel.app/
- Manual verification at each phase boundary
- Note: pure-local devnet doesn't exercise wallet/proving path

## 9. Compliance & security notes

- Deposit screening is enforced onchain by the protocol
- Selective disclosure exists for legitimate regulatory requests
- Team owns legal/compliance decisions and any use-case KYC
- Never present STRK20 as a screening workaround

## 10. Open items to re-verify at build time

- Xverse dapp-facing Wallet API status
- Fee/paymaster design (wallet flows sponsor gas but not pool fees)
- Current `starknet` dist-tags on npm
- Pool fee amount (was 4 STRK at time of writing)

## 11. Links

- STRK20 pool contract: https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
- Privacy SDK monorepo: https://github.com/starkware-libs/starknet-privacy
- starknet.js v10.4.0: https://github.com/starknet-io/starknet.js/releases/tag/v10.4.0
- get-starknet v6.0.3: https://github.com/starknet-io/get-starknet
- WalletAccount guide: https://starknet-js.com/docs/next/guides/account/walletAccount/#with-get-starknet-v6
- What STRK20 is: https://strk20-by-example.org/what-is-strk20
- Wallet API route overview: https://strk20-by-example.org/starknet-wallet-api/overview
- starknet.js wiring: https://strk20-by-example.org/starknet-wallet-api/starknet-js
- React apps / useStrk20 hooks: https://strk20-by-example.org/starknet-wallet-api/starknet-start-hook
- Notes & nullifiers: https://strk20-by-example.org/notes-and-nullifiers
- Viewing keys: https://strk20-by-example.org/viewing-keys
- Actions & proofs: https://strk20-by-example.org/actions-and-proofs

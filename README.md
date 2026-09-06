# Ownerz

> Post-quantum privacy infrastructure for payments and services.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Starknet](https://img.shields.io/badge/Built%20on-Starknet-purple)](https://starknet.io)
[![Post-Quantum](https://img.shields.io/badge/Post--Quantum-Secure-green)](https://eprint.iacr.org/2018/046)

---

## What is Ownerz?

Ownerz is a **post-quantum privacy infrastructure platform** that enables anonymous payments and private services on Starknet.

We combine:
- **STARKs** — quantum-resistant proof system (no trusted setup, hash-based cryptography)
- **STRK20** — Starknet's native privacy standard for ERC-20 tokens (shielded balances, private transfers, compliant by design)
- **Privacy Pool** — note-based anonymous payment pool with ZK-STARK proofs
- **Cloudflare** — edge compute and storage with automatic post-quantum TLS

**The result:** Post-quantum anonymity in both payments and services — the first platform where your data and transactions remain private against both current and future quantum adversaries.

---

## Why Post-Quantum?

Quantum computers will break today's elliptic curve cryptography. This isn't theoretical — it's a timeline:

- **Harvest-now-decrypt-later** attacks mean encrypted data collected today can be decrypted when quantum computers arrive
- **NIST finalized PQC standards** in August 2024 (FIPS 203, 204, 205)
- **U.S. Executive Order 14412** mandates federal agency migration to PQC by 2030
- **STARKs are the only production-grade proof system** with inherent post-quantum security (hash-based, no elliptic curve assumptions)

Ownerz starts from a quantum-safe foundation. No migration needed. No technical debt.

---

## What is STRK20?

**STRK20 is not a token — it's a privacy-native token standard for Starknet.**

> "STRK20 is Starknet's native privacy standard for ERC-20 tokens: any asset can move through an encrypted pool, prove its own validity with a zero-knowledge proof, and settle without broadcasting who sent what to whom."
> — [strk20.starknet.io](https://strk20.starknet.io)

### How It Works

| Concept | Description |
|---------|-------------|
| **Token Framework** | Embeds shielding directly into any ERC-20 token's transaction flow |
| **Privacy by Default** | Balances and transfers are hidden by default — no wrapping, no external mixer |
| **Note-Based Pool** | UTXO model (not a mixer) — deposit notes, prove validity, withdraw to fresh address |
| **ZK-STARK Proofs** | Quantum-resistant by design (hash-based, no elliptic curve assumptions) |
| **Compliance** | Viewing keys enable selective disclosure for regulators |
| **DeFi Composable** | Private swaps (AVNU, Ekubo), lending (Vesu), staking (Endur) |

### Key Dates

- **March 10, 2026:** STRK20 announced with Starknet v0.14.2 ("The Privacy Engine")
- **May 12, 2026:** strkBTC — first live STRK20 asset
- **June 9, 2026:** STRK20 framework live on mainnet
- **June 25, 2026:** USDC added as second STRK20 asset

### Two Integration Routes

| Route | Target | What You Touch |
|-------|--------|----------------|
| **Wallet API** | Dapps (like Ownerz) | App asks wallet to shield/transfer/unshield. Wallet handles proving, notes, keys. |
| **Privacy SDK** | Wallets & advanced integrators | Direct control over note discovery, registration, proving. |

**Ownerz uses the Wallet API route** — the app never touches viewing keys; the user's Ready/Xverse wallet handles that.

---

## Core Products

### 1. Anonymous Payments

Privacy Pool on Starknet with STARK proofs:

```
Deposit → Pool (STARK proof) → Withdraw to fresh address
```

- **Zero-knowledge:** Proves funds are clean without revealing sender, receiver, or amount
- **Quantum-resistant:** STARK proofs use hash functions, not elliptic curves
- **Compliance-ready:** Threshold disclosure for regulators (viewing keys)
- **Multi-asset:** Single pool for STRK, USDC, and other tokens

### 2. Private Data Marketplace

Buy and sell encrypted data with anonymous payments:

```
Seller: Encrypt → Upload → Set price → Register CID
Buyer: Pay privately → Auto-receive decryption key → Download
```

- **End-to-end encryption:** ML-KEM768 + AES-256-GCM (post-quantum)
- **No intermediaries:** Direct peer-to-peer transactions
- **Auto key delivery:** Smart contract reveals decryption key on payment
- **Decentralized storage:** Cloudflare R2 + IPFS backup

### 3. Private Computation

STARK-proven smart contracts that execute logic without revealing inputs:

- Payroll processing (prove salary without revealing amounts)
- Auctions (prove bid validity without revealing bid)
- Competitive bidding (prove compliance without revealing offer)

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Blockchain** | Starknet | L2 with STARK proofs (quantum-resistant) |
| **Smart Contracts** | Cairo | Provable computation |
| **Privacy Standard** | STRK20 | Privacy-native token framework for ERC-20 |
| **Storage** | Cloudflare R2 + IPFS | Encrypted data (zero egress) |
| **Compute** | Cloudflare Workers | Edge API with PQ TLS |
| **Database** | Cloudflare D1 | User metadata, transaction logs |
| **Encryption** | ML-KEM768 + AES-256-GCM | Post-quantum client-side encryption |
| **Frontend** | Next.js + starknet.js | Web interface |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    USER LAYER                        │
│  Web App / Mobile / API                             │
│  (Cloudflare Workers — PQ TLS by default)           │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│                 EDGE LAYER (Cloudflare)              │
│  Workers API  │  D1 Metadata  │  R2 Encrypted      │
│  Gateway       │  Store         │  Blob Storage     │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              SETTLEMENT LAYER (Starknet L2)          │
│  ┌─────────────────────────────────────────────┐    │
│  │ STARK Proof System (quantum-resistant)       │    │
│  └─────────────────────────────────────────────┘    │
│  STRK20 Privacy Pool  │  Cairo Contracts           │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              COMPLIANCE LAYER                        │
│  Association Set Provider  │  Viewing Key Service   │
│  ZK Compliance Proofs (FATF Travel Rule compatible) │
└─────────────────────────────────────────────────────┘
```

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/cxto21/ownerz.git
cd ownerz

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your configuration

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

**Requirements:**
- [Ready extension](https://ready.app/) for Starknet wallet
- Node.js 18+

---

## How Privacy Works

### For Sellers

1. Encrypt your file locally (ML-KEM768 + AES-256-GCM)
2. Upload to Cloudflare R2 (encrypted at rest)
3. Set price in STRK
4. Register CID in smart contract (no public listing)
5. Share CID privately with buyer

### For Buyers

1. Receive CID from seller (private channel)
2. Connect Starknet wallet
3. Click "Pay Privately"
4. Wallet generates STARK proof (quantum-resistant)
5. Auto-receive decryption key via smart contract
6. Download and decrypt file

### For Regulators

- **Viewing keys:** Selective disclosure for compliance audits
- **Association Set Provider:** Proves fund cleanliness without identity
- **Threshold disclosure:** Prove transaction properties without full reveal

---

## Roadmap

### Phase 1: Foundation (Weeks 1-4)
- [ ] Integrate STRK20 Wallet API
- [ ] Deploy Cairo contracts to Sepolia
- [ ] End-to-end flow: shield → pay → key reveal → decrypt
- [ ] Apply for Starknet Seed Grant ($25K)

### Phase 2: Marketplace (Weeks 5-8)
- [ ] Seller flow: upload → price → register CID
- [ ] Buyer flow: CID → pay → auto-reveal key
- [ ] Balance toggle (public / shielded / total)
- [ ] Mobile-responsive privacy UX

### Phase 3: Scale (Weeks 9-12)
- [ ] Migrate storage to Cloudflare R2
- [ ] SIWS authentication via Workers
- [ ] Private swaps via AVNU integration
- [ ] Mainnet deployment

### Phase 4: Startup (Months 4-6)
- [ ] Enterprise API for private data marketplace
- [ ] Compliance dashboard for threshold disclosure
- [ ] Cross-chain privacy via LayerZero
- [ ] Fundraise preparation

---

## Comparison

| Feature | Ownerz | Zcash | Tornado Cash | Aztec |
|---------|--------|-------|--------------|-------|
| Post-quantum | ✅ STARKs | 🔄 Migration needed | ❌ SNARKs | ❌ SNARKs |
| Compliance | ✅ Threshold disclosure | ✅ Viewing keys only | ❌ Sanctioned | 🔄 Building |
| DeFi composability | ✅ AVNU/Ekubo | ❌ Isolated | ❌ Mixer only | 🔄 Alpha |
| Multi-asset | ✅ STRK20 single pool | ❌ ZEC only | 🔄 Limited | ❌ App-specific |
| Storage integration | ✅ R2 + IPFS | ❌ N/A | ❌ N/A | ❌ N/A |
| Edge infrastructure | ✅ Cloudflare PQ | ❌ Self-hosted | ❌ Self-hosted | ❌ Self-hosted |

---

## Contributing

We welcome contributions. Please read our [Contributing Guide](CONTRIBUTING.md) before submitting a PR.

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Links

- **Documentation:** [docs.ownerz.io](https://docs.ownerz.io)
- **Discord:** [discord.gg/ownerz](https://discord.gg/ownerz)
- **Twitter:** [@ownerz_io](https://twitter.com/ownerz_io)
- **GitHub:** [github.com/cxto21/ownerz](https://github.com/cxto21/ownerz)

---

<p align="center">
  <sub>Built with ❤️ on Starknet. Post-quantum privacy for everyone.</sub>
</p>

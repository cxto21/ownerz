# Ownerz

> Post-quantum encrypted computing resources. Storage and payments, both quantum-resistant.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Starknet](https://img.shields.io/badge/Built%20on-Starknet-purple)](https://starknet.io)
[![Post-Quantum](https://img.shields.io/badge/Post--Quantum-Secure-green)](https://eprint.iacr.org/2018/046)

---

## What is Ownerz?

Ownerz is a **post-quantum privacy infrastructure for computing resources**. We offer storage and compute services where both the **data** and the **payments** are encrypted with quantum-resistant cryptography.

You store files → encrypted with post-quantum crypto.
You pay for storage → encrypted with post-quantum crypto.
Your identity → protected by privacy pools.

**The result:** A computing platform where neither your data nor your financial activity can be intercepted — not now, not by future quantum computers.

---

## Why Post-Quantum?

Quantum computers will break today's elliptic curve cryptography. This isn't theoretical — it's a timeline:

- **Harvest-now-decrypt-later** attacks mean encrypted data collected today can be decrypted when quantum computers arrive
- **NIST finalized PQC standards** in August 2024 (FIPS 203, 204, 205)
- **U.S. Executive Order 14412** mandates federal agency migration to PQC by 2030
- **STARKs are the only production-grade proof system** with inherent post-quantum security (hash-based, no elliptic curve assumptions)

Ownerz starts from a quantum-safe foundation. No migration needed. No technical debt.

---

## Core Services

### 1. Encrypted Storage

Post-quantum encrypted file storage on Cloudflare R2 + IPFS:

```
Upload → Encrypt (ML-KEM768 + AES-256-GCM) → Store on R2
Download → Decrypt client-side → Access your data
```

- **End-to-end encryption:** ML-KEM768 + AES-256-GCM (post-quantum)
- **Zero egress:** Cloudflare R2 with no download fees
- **Decentralized backup:** IPFS for content-addressed redundancy
- **Client-side decryption:** Data never decrypted on servers

### 2. Encrypted Payments

Payments for storage services via STRK20 Privacy Pool:

```
Pay → STRK20 Privacy Pool (STARK proof) → Service unlocked
```

- **Post-quantum proofs:** STARK-based (hash-based, quantum-resistant)
- **Anonymous:** Payment details hidden via zero-knowledge proofs
- **Compliant:** Viewing keys for regulatory disclosure when required
- **Multi-asset:** Pay with STRK, USDC, or other supported tokens

### 3. Compute Resources (Coming Soon)

Private computation on encrypted data:

- Process data without revealing contents
- STARK-proven computation correctness
- Edge execution via Cloudflare Workers

---

## How It Works

### For Users

1. **Connect** your Starknet wallet (Ready extension)
2. **Upload** files — encrypted client-side with post-quantum crypto
3. **Pay** for storage — payment encrypted via STRK20 Privacy Pool
4. **Access** your data — decrypt locally, never exposed to servers

### For Developers

```javascript
import { Ownerz } from '@ownerz/sdk';

const ownerz = new Ownerz({ wallet: '0x...' });

// Upload (post-quantum encrypted)
await ownerz.store(file);

// Download (client-side decryption)
const data = await ownerz.retrieve('file-key');

// Pay (anonymous via STRK20)
await ownerz.pay({ amount: '1000000', token: 'USDC' });
```

---

## What Makes This Different

| Feature | Ownerz | Traditional Cloud | Other Web3 Storage |
|---------|--------|-------------------|-------------------|
| Data encryption | ✅ Post-quantum (ML-KEM768) | ❌ Server-side | ⚠️ Varies |
| Payment privacy | ✅ STRK20 Privacy Pool | ❌ Exposed | ❌ Exposed |
| Egress fees | ✅ Zero (R2) | ❌ High | ⚠️ Varies |
| Quantum-resistant | ✅ Both data + payments | ❌ No | ❌ No |
| Decentralized backup | ✅ IPFS | ❌ No | ✅ Yes |
| Compliance | ✅ Viewing keys | ✅ Full access | ❌ Limited |

**The moat:** Ownerz is the only platform where both your DATA and your PAYMENTS are post-quantum encrypted. Not one or the other — both.

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Blockchain** | Starknet | L2 with STARK proofs (quantum-resistant) |
| **Privacy Standard** | STRK20 | Anonymous payments for services |
| **Storage** | Cloudflare R2 + IPFS | Encrypted data (zero egress) |
| **Compute** | Cloudflare Workers | Edge API with PQ TLS |
| **Database** | Cloudflare D1 | User metadata, file index |
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
│              PRIVACY LAYER (Starknet)                │
│  STRK20 Privacy Pool — anonymous payments           │
│  STARK proofs — quantum-resistant verification      │
│  Cairo contracts — service logic                    │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              ENCRYPTION LAYER                        │
│  ML-KEM768 + AES-256-GCM — post-quantum encryption  │
│  Client-side — data never decrypted on servers      │
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

## Roadmap

### Phase 1: Storage MVP (Weeks 1-4)
- [ ] Post-quantum encrypted storage on Cloudflare R2
- [ ] STRK20 payment integration
- [ ] End-to-end flow: upload → encrypt → pay → store
- [ ] Apply for Starknet Seed Grant ($25K)

### Phase 2: Marketplace (Weeks 5-8)
- [ ] Seller flow: upload → set price → register CID
- [ ] Buyer flow: pay → auto-reveal decryption key
- [ ] Balance toggle (public / shielded / total)
- [ ] Mobile-responsive privacy UX

### Phase 3: Scale (Weeks 9-12)
- [ ] SIWS authentication via Workers
- [ ] Private swaps via AVNU integration
- [ ] Mainnet deployment
- [ ] SDK release for developers

### Phase 4: Startup (Months 4-6)
- [ ] Enterprise API for private data storage
- [ ] Compliance dashboard for threshold disclosure
- [ ] Compute resources (private processing)
- [ ] Fundraise preparation

---

## STRK20 — How Payments Work

**STRK20 is not a token — it's a privacy-native token standard for Starknet.**

> "STRK20 is Starknet's native privacy standard for ERC-20 tokens: any asset can move through an encrypted pool, prove its own validity with a zero-knowledge proof, and settle without broadcasting who sent what to whom."
> — [strk20.starknet.io](https://strk20.starknet.io)

Ownerz uses STRK20 to accept anonymous payments for storage services. The user's wallet handles the privacy flow — Ownerz never touches viewing keys or payment details.

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

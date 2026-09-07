# Ownerz

> Post-quantum data infrastructure. End-to-end encrypted storage, private payments.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Starknet](https://img.shields.io/badge/Built%20on-Starknet-purple)](https://starknet.io)
[![Post-Quantum](https://img.shields.io/badge/Post--Quantum-Secure-green)](https://eprint.iacr.org/2018/046)

---

## What is Ownerz?

Ownerz is a **post-quantum data infrastructure provider**. Encrypted storage and private payments where both the **data** and the **financial activity** are protected with quantum-resistant cryptography.

- **Encrypted storage** — ML-KEM768 + AES-256-GCM (post-quantum)
- **Post-quantum TLS 1.3** — data encrypted in transit
- **Private payments** — STRK20 Privacy Pool on Starknet (STARK proofs)
- **Zero egress** — Cloudflare R2, no download fees

---

## How It Works

1. **Connect** your Starknet wallet (Ready extension)
2. **Upload** files — encrypted end-to-end with post-quantum TLS 1.3
3. **Pay** for storage — payment protected via STRK20 Privacy Pool
4. **Access** your data — decrypt locally, never exposed to servers

---

## Stack

| Layer | Technology |
|-------|-----------|
| **Blockchain** | Starknet (STARK proofs, quantum-resistant) |
| **Payment Privacy** | STRK20 Privacy Pool |
| **Storage** | Cloudflare R2 + IPFS |
| **Encryption** | ML-KEM768 + AES-256-GCM |
| **Transport** | Post-quantum TLS 1.3 |
| **Compute** | Cloudflare Workers |
| **Frontend** | Next.js + starknet.js |

---

## Quick Start

```bash
git clone https://github.com/cxto21/ownerz.git
cd ownerz
npm install --legacy-peer-deps
cp .env.example .env
# Edit .env with your RPC key and contract addresses
npm run dev
```

Open [http://localhost:3001](http://localhost:3001)

**Requirements:** [Ready extension](https://ready.app/) · Node.js 18+

---

## Roadmap

- [x] Post-quantum encrypted storage (ML-KEM768 + AES-256-GCM)
- [x] Post-quantum TLS 1.3 transport
- [x] STRK20 private payments integration
- [x] End-to-end flow: upload → encrypt → pay → store
- [x] Mobile wallet support (StarknetKit + WalletConnect QR)
- [x] Mainnet migration (SN_MAIN)
- [ ] SIWS authentication
- [ ] SDK release for developers
- [ ] Compute resources (private processing on encrypted data)

---

## STRK20 — How Payments Work

**STRK20 is not a token — it's a privacy-native token standard for Starknet.**

> "STRK20 is Starknet's native privacy standard for ERC-20 tokens: any asset can move through an encrypted pool, prove its own validity with a zero-knowledge proof, and settle without broadcasting who sent what to whom."
> — [strk20.starknet.io](https://strk20.starknet.io)

Ownerz uses STRK20 to accept anonymous payments for infrastructure services. The user's wallet handles the privacy flow — Ownerz never touches viewing keys or payment details.

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

<p align="center">
  <sub>Built with ❤️ on Starknet. Post-quantum privacy for everyone.</sub>
</p>

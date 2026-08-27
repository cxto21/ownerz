# Ownerz — Post-Quantum Data Sovereignty

## Core Value
A platform where anyone can store, share, monetize, and **process** private data — on their own terms. Post-quantum encrypted vaults, private STRK20 payments, soulbound access tokens, and TEE-secured compute, built on Starknet and Filecoin. No intermediaries, no surveillance, no quantum vulnerability.

## Roadmap

### H1 — Vault *(shipped baseline)*
Post-quantum encrypted vault, Filecoin storage, Starknet access control. End-to-end PQC (ML-KEM768 + AES-256-GCM, client-side).

### H2 — Marketplace *(current focus)*
Private listings, selective disclosure, on-chain settlement. Soulbound access tokens (non-transferable, time-bound). STRK20 payments with ZK-proof privacy. TLS 1.3 + hashed-version client channel for browser integrity.

- Real wallet connection (Ready extension)
- STRK20 private payments for data access
- Fil One storage integration
- Soulbound access tokens (price, duration, expiry per holder)
- Seller: upload + set price + register CID in contract
- Buyer: pay privately → auto-reveal decryption key
- Cairo smart contract for CID/price registry
- Fee UX and pool fee handling

### H3 — Compute
TEE-secured analytics over encrypted data (Intel SGX / AMD SEV-SNP). TEE attestation API. Sealed encrypted results. PQC key operations inside the enclave (not user-space JS).

- Decryption key stored encrypted in smart contract
- Auto-reveal on successful payment (no manual sharing)
- Key rotation and recovery mechanisms
- Integration with post-quantum encryption in TEE context

### H4 — Agent Economy
Data owners publish compute jobs; agents execute on TEE enclaves; settlement in STRK20; on-chain reputation. Privacy-preserving data cooperatives and data unions.

## How It Works
Users connect their Starknet wallet (Ready extension) and upload locally encrypted files to Fil One (Filecoin). The seller registers only the CID and price on the STRK20 smart contract (no public listing). The buyer accesses via direct CID, makes an anonymous purchase via ZK-proofs, and automatically receives the decryption key in a private blockchain event. Data stays encrypted on IPFS, decryptable only with the key the contract delivers to the verified buyer.

## Tech Stack
- **Blockchain:** Starknet + STRK20 (private payments via ZK-proofs)
- **Storage:** Fil One / Filecoin (encrypted end-to-end, permanent storage)
- **Encryption:** ML-KEM768 + AES-256-GCM (post-quantum, client-side)
- **Compute (H3):** TEE-secured analytics (Intel SGX / AMD SEV-SNP) — sealed results, hardware attestation
- **Frontend:** Next.js + starknet.js + get-starknet v6
- **Smart Contract:** Cairo (CID registry, anonymous purchase, key delivery, soulbound access tokens)
- **Privacy:**
  - Seller: No public listings (only CID shared privately)
  - Buyer: Transaction hidden via ZK-proofs
  - Data: Encrypted on IPFS, decryptable only with contract-delivered key
  - Browser channel: TLS 1.3 + hashed-version client identifier

## Getting Started

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your Fil One credentials + Alchemy RPC key

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

**Note:** Requires [Ready extension](https://ready.app/) for STRK20 private payments.

## License

MIT

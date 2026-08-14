# Ownerz — Privacy-First Data Marketplace

## Core Value
A marketplace where anyone can monetize private data on blockchain with anonymous transactions, no intermediaries, no hidden costs.

## How It Works
Users connect their Starknet wallet (Braavos/Argent) and upload locally encrypted files to Fil One (Filecoin). The seller registers only the CID and price on the STRK20 smart contract (no public listing). The buyer accesses via direct CID, makes an anonymous purchase via ZK-proofs, and automatically receives the decryption key in a private blockchain event. Data stays encrypted on IPFS, decryptable only with the key the contract delivers to the verified buyer.

## Tech Stack
- **Blockchain:** Starknet + STRK20 (private payments via ZK-proofs)
- **Storage:** Fil One / Filecoin (encrypted end-to-end, permanent storage)
- **Encryption:** ML-KEM768 + AES-256-GCM (post-quantum, client-side)
- **Frontend:** Next.js + @starknet-react
- **Smart Contract:** Cairo (CID registry, anonymous purchase, key delivery)
- **Privacy:**
  - Seller: No public listings (only CID shared privately)
  - Buyer: Transaction hidden via ZK-proofs
  - Data: Encrypted on IPFS, decryptable only with contract-delivered key

## Roadmap
**Phase 1 (Current):** Direct CID — Maximum Privacy
**Phase 2:** Marketplace listings with industry filters (less private, more discovery)

## Getting Started

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your Fil One credentials

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## License

MIT

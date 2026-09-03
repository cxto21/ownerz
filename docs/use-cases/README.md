# DataVaultz — Use Cases

Real-world markets where privacy-first data delivery solves a concrete problem.

## Why DataVaultz?

Traditional file sharing (email, Drive, Dropbox) leaks metadata: who sent what, to whom, when. For industries handling sensitive data, that exposure creates legal, competitive, and reputational risk.

**DataVaultz solves this with:**

- **Post-quantum encryption** — data encrypted client-side before upload with NIST-standardized algorithms
- **Anonymous payments** (ZK-proofs) — buyer's identity hidden from seller and chain
- **Private key delivery** — decryption key auto-revealed to buyer via smart contract, never stored in plaintext
- **No public listings** — seller shares CID directly; no searchable catalog exists
- **Immutable storage** — encrypted data persists on decentralized infrastructure with no central server

## Use Cases

| Market | Buyer | Seller | Sensitivity | File |
|--------|-------|--------|-------------|------|
| Healthcare | Patient, insurer | Clinic, lab | Medical records, PHI | [healthcare.md](./healthcare.md) |
| Cybersecurity | SOC team, auditor | Security firm | Vuln reports, incident data | [cybersecurity.md](./cybersecurity.md) |
| Legal | Client, opposing counsel | Attorney | Privileged documents | [legal.md](./legal.md) |
| Trading Signals | Fund, retail trader | Signal provider | Proprietary strategies | [trading-signals.md](./trading-signals.md) |

## Selection Criteria

Each use case was evaluated on:

1. **Legitimate privacy need** — not hiding wrongdoing, but protecting lawful sensitive data
2. **Metadata exposure cost** — what happens if "who shared what with whom" leaks
3. **Post-quantum relevance** — does the data need to stay secret for years/decades?
4. **Payment privacy** — does anonymous payment add real value beyond file encryption?

## Ethical Boundaries

DataVaultz is designed for **lawful privacy**. Every use case above involves:

- Data the seller is legally entitled to share
- Data the buyer is legally entitled to receive
- No circumvention of lawful discovery, regulation, or oversight

DataVaultz **does not enable** tax evasion, sanctions circumvention, illicit trade, or any activity where privacy would facilitate harm. The platform encrypts data; it does not judge legality — that responsibility remains with the participants.

## Next Steps

- Validate each use case with 2-3 potential buyers per market
- Measure willingness-to-pay vs. existing alternatives (encrypted email, secure portals)
- Identify regulatory requirements (HIPAA, SOC 2, attorney-client privilege) that DataVaultz naturally satisfies

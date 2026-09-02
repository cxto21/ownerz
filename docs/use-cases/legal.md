# Legal — Confidential Attorney-Client Document Delivery

## The Problem

An attorney prepares a confidential report for a client — litigation strategy, privileged communication, evidence analysis, or settlement terms. The document must reach the client without a third party knowing it exists.

Today, even encrypted email leaks the fact that attorney and client communicated at a specific time about a specific matter. In litigation, **the metadata of delivery can be as damaging as the content.** Opposing counsel can subpoena email logs, metadata timestamps, and provider records to establish that a privileged communication occurred — even if they can't read the content.

For whistleblower attorneys, the risk is higher: delivering a report about corporate misconduct to a regulator via email creates a traceable link between the attorney, the client, and the investigation.

## Who Buys, Who Sells

| Role | Actor |
|------|-------|
| **Seller** | Attorney, law firm, legal consultant, expert witness |
| **Buyer** | Client, co-counsel, opposing counsel (settlement), regulator (authorized disclosure) |

## What's Shared

- Litigation strategy memos
- Privileged attorney-client communications
- Expert witness reports (damages analysis, forensic accounting)
- Settlement term sheets
- Evidence packages (documents, recordings, exhibits)
- Whistleblower disclosures (pre-filing)

**Sensitivity:** Attorney-client privilege. In most jurisdictions, the privilege survives the attorney-client relationship indefinitely. Breach of privilege can result in malpractice liability, case dismissal, or sanctions.

## Why DataVaultz

| Alternative | Limitation | DataVaultz advantage |
|-------------|-----------|---------------------|
| Email (even encrypted) | Metadata (who, when, subject) visible | No sender/receiver on-chain |
| Firm's secure portal | Centralized; firm controls access | Decentralized; key in smart contract |
| Physical courier | Delivery receipt reveals recipient | CID is delivery proof without identity |
| Secure messaging | Requires synchronous presence | Async; buyer pays when ready |

**Post-quantum angle:** Privileged documents must remain confidential for decades. A case decided in 2026 may be appealed in 2035; the strategy memo must not be decryptable by then.

## Flow

```
1. Attorney prepares report (PDF, Word, evidence archive)
2. Attorney encrypts locally with ML-KEM768 + AES-256-GCM
3. Attorney uploads encrypted file to Fil One (Filecoin)
4. Attorney registers CID + price in STRK20 contract (no public listing)
5. Attorney shares CID with client via secure channel (phone, in-person, Signal)
6. Client pays via ZK-proof (anonymous — attorney sees payment, not identity)
7. Smart contract delivers decryption key to client's wallet
8. Client decrypts and reviews locally
```

## Ethics & Compliance

- **Legitimate:** Attorney is ethically obligated to protect privileged communications. DataVaultz strengthens that obligation by removing metadata exposure.
- **Attorney-client privilege:** No privileged content is stored on-chain. The CID is an opaque hash; the payment is anonymous. Neither reveals the nature of the communication.
- **Boundary:** Attorneys must still comply with discovery obligations and court orders. DataVaultz does not enable spoliation or concealment of evidence that a court has ordered produced. Privilege is not a shield for ongoing fraud.

## Value Metrics

| Metric | Current (email/portal) | DataVaultz |
|--------|----------------------|-----------|
| Metadata exposure | Email logs, timestamps, subject lines | None (no on-chain metadata) |
| Privilege breach risk | High (provider subpoena) | Low (no intermediary with records) |
| Delivery proof | Email receipt (mutable) | CID on-chain (immutable) |
| Jurisdictional flexibility | Depends on provider's data residency | Filecoin (global, jurisdiction-agnostic) |
| Post-quantum readiness | None | ML-KEM768 + AES-256-GCM |

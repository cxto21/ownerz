# Healthcare — Private Medical Report Delivery

## The Problem

A sanatorio (private clinic) delivers lab results, imaging reports, and treatment plans to patients. Today these go via email, patient portals, or printed envelopes — all of which leak metadata:

- **Email:** Subject lines, sender/receiver addresses, and timestamps are visible to the email provider and any intermediary. A compromised mailbox exposes the entire medical history.
- **Patient portals:** Centralized databases that the clinic administers — a breach exposes all patients, not one.
- **Printed mail:** The envelope itself signals "medical results" to anyone who handles it.

For patients with sensitive diagnoses (HIV, oncology, mental health, genetic conditions), metadata exposure can cause discrimination, insurance penalties, or social stigma.

## Who Buys, Who Sells

| Role | Actor |
|------|-------|
| **Seller** | Private clinic, diagnostic lab, telemedicine platform |
| **Buyer** | Patient (individual), insurance company (authorized), second-opinion physician |

## What's Shared

- Lab results (blood panels, genetic tests, biopsies)
- Imaging reports (MRI, CT, X-ray with radiologist notes)
- Treatment plans and prescriptions
- Discharge summaries

**Sensitivity:** Protected Health Information (PHI) under HIPAA (US), RGPD (EU), or local equivalents. Retention requirements: 5-20 years depending on jurisdiction.

## Why DataVaultz

| Alternative | Limitation | DataVaultz advantage |
|-------------|-----------|---------------------|
| Email (encrypted or not) | Metadata visible; PHI in transit | No metadata; encrypted at rest on decentralized storage |
| Patient portal | Centralized; clinic controls access | Decentralized; key delivered by smart contract |
| Secure messaging (Signal, WhatsApp) | Requires both parties online; no audit trail | Asynchronous; CID + payment on-chain |
| USB / physical media | Loss risk; no delivery proof | Immutable storage; CID as delivery receipt |

**Post-quantum angle:** Medical records must remain confidential for decades. A diagnosis made today should not be decryptable by a quantum computer in 2040.

## Flow

```
1. Clinic generates report (PDF, HL7 FHIR bundle)
2. Clinic encrypts locally with post-quantum encryption
3. Clinic uploads encrypted file to decentralized storage
4. Clinic registers CID + price in smart contract (no public listing)
5. Clinic shares CID privately with patient (QR code at visit, encrypted email)
6. Patient pays via ZK-proof (anonymous — clinic sees payment, not identity)
7. Smart contract delivers decryption key to patient's wallet
8. Patient decrypts and views report locally
```

## Ethics & Compliance

- **Legitimate:** Clinic is legally authorized to share PHI with the patient. Patient has right to access their own data.
- **HIPAA alignment:** No PHI stored on-chain. Payment is anonymous but amount is visible (ERC-20 legs). Key delivery is private.
- **Boundary:** Clinic must still maintain its own HIPAA-compliant records for regulatory audits. DataVaultz replaces the delivery channel, not the clinic's internal storage.

## Value Metrics

| Metric | Current (email/portal) | DataVaultz |
|--------|----------------------|-----------|
| Metadata exposure risk | High (email headers, portal logs) | None (no sender/receiver on-chain) |
| Breach blast radius | All patients (centralized DB) | Single file (client-side encryption) |
| Data longevity | Depends on clinic's server | Permanent (decentralized storage) |
| Delivery proof | Email receipt (spoofable) | CID on-chain (immutable) |
| Post-quantum readiness | None | NIST post-quantum encryption |

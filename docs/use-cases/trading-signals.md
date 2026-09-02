# Trading Signals — Anonymous Proprietary Strategy Delivery

## The Problem

A trading signal provider sells entry/exit signals to paying subscribers. The value of a signal decays with every second after delivery — if the market sees the signal, the alpha disappears.

Today, signal providers distribute via Telegram groups, Discord channels, or email lists. The problem isn't encryption — it's **who receives the signal and when.** If a whale knows that 500 retail traders just received a "buy BTC at $65k" signal, they can front-run the order flow. The metadata (list of recipients, delivery timestamp) is the attack surface.

For institutional signal providers selling to hedge funds, the problem is different: the fund doesn't want its trading counterparties to know it subscribes to a specific signal provider. If a counterparty sees "Fund X receives signals from Provider Y," they can infer Fund X's strategy.

## Who Buys, Who Sells

| Role | Actor |
|------|-------|
| **Seller** | Signal provider, quantitative research firm, proprietary analyst |
| **Buyer** | Retail trader (individual), hedge fund (institutional), family office |

## What's Shared

- Entry/exit signals (price, direction, timeframe)
- Quantitative model outputs (factor scores, allocation targets)
- Proprietary research reports (macro thesis, sector analysis)
- Backtesting data and strategy parameters

**Sensitivity:** Commercially valuable information with a short half-life. The value is directly proportional to how few people know about it at the time of execution.

## Why DataVaultz

| Alternative | Limitation | DataVaultz advantage |
|-------------|-----------|---------------------|
| Telegram / Discord | Group visibility; no delivery isolation | Per-buyer CID; no group metadata |
| Email blast | Recipient list visible to provider; timestamp leak | Anonymous payment; no recipient list |
| Encrypted email | Same metadata problem; PGP key exchange friction | Single-channel delivery; no PGP |
| Secure portal | Centralized; provider sees who downloads when | Decentralized; key in smart contract |

**Post-quantum angle:** Quantitative strategies may remain proprietary for years. A factor model published today should not be reverse-engineered from encrypted archives in 2035.

## Flow

```
1. Signal provider generates signal (JSON, PDF, spreadsheet)
2. Provider encrypts locally with ML-KEM768 + AES-256-GCM
3. Provider uploads encrypted signal to Fil One (Filecoin)
4. Provider registers CID + price in STRK20 contract (no public listing)
5. Provider shares CID with buyer (direct message, no group broadcast)
6. Buyer pays via ZK-proof (anonymous — provider sees payment, not identity)
7. Smart contract delivers decryption key to buyer's wallet
8. Buyer decrypts and executes signal locally
```

## Ethics & Compliance

- **Legitimate:** Signal providers sell proprietary analysis. Buyers pay for information they are legally entitled to receive. No market manipulation is involved.
- **No front-running facilitation:** DataVaultz delivers the signal; it does not execute trades. The buyer's broker and exchange handle execution. Front-running is a broker/exchange problem, not a delivery channel problem.
- **Boundary:** This does not enable insider trading. The signal is the provider's own analysis, not material non-public information from a public company. If the signal is based on MNPI, the illegality is in the sourcing, not the delivery.

## Value Metrics

| Metric | Current (Telegram/email) | DataVaultz |
|--------|------------------------|-----------|
| Recipient metadata exposure | High (group members, timestamps) | None (per-buyer CID) |
| Alpha decay from leakage | Significant (group members front-run) | Minimal (isolated delivery) |
| Counterparty identification | Possible (subscription records) | Impossible (anonymous payment) |
| Delivery speed | Seconds (Telegram) but with leakage risk | Seconds (Fil upload + CID share) |
| Post-quantum readiness | None | ML-KEM768 + AES-256-GCM |

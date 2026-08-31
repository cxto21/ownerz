# Step 1: Wallet-to-Data Linking — Cloudflare-Only

## Intent

Herramienta infra para devs: **guardar datos vinculados a wallet sin password**, listos para mercado privado. S3 standard + ENS/PQ, todo Cloudflare. No garantizamos servicio hoy, si garantizamos dato via CID.

## Scope

### IN (hackathon)
- Auth SIWS Starknet (AA-safe) -> JWT
- D1 `users/nonces/vaults_meta/api_keys`
- R2 hot + CF IPFS Gateway fallback solo lectura + pin Filecoin async `waitUntil`
- CIDv1 real (`bafy...`) en `vaults_meta.cid`
- `lib/storage/index.js` como port, `R2Adapter` primario
- `lib/s3.js` parametrizado: R2 binding o S3 endpoint

### OUT (vision doc)
- Instalable P2P local
- TEE CoCo compute
- Incentivo PoSt/storage
- OpenSea Tools listing
- Mercado agentes IA

---

## Architecture: 3 Layers

### Layer 1: Auth (wallet -> identidad)

**Challenge flow:**
1. `POST /api/auth/challenge {address}` — genera nonce 16B `crypto.getRandomValues`, guarda en D1 `nonces(address, nonce, expires_at +5m)`, devuelve SNIP-12 typedData `domain:{name:"DataVaultz", chainId:"SN_SEPOLIA", version:"1"}` + `message:{address, nonce, issuedAt, expiresAt}`

2. `POST /api/auth/login {address, signature, typedData}` — Worker valida firma via `provider.callContract({contractAddress: address, entrypoint:'isValidSignature'})`. Si `0x56414c4944` (VALID), emite JWT `sub:address` 24h con `env.JWT_SECRET`

3. Middleware JWT en todo `/api/*` protegido — `payload.sub` = `wallet_address` canonica

**Por que AA-safe:** `verifyTypedData` local rompe Braavos/Argent/Ready que son smart accounts. On-chain validation es el unico path correcto.

### Layer 2: Storage (dato + estandar S3)

**Upload:**
- `lib/crypto/cid.js` nuevo: `hash(buffer) -> CIDv1 dag-pb`
- `pages/api/upload.js` — `R2.put(cid, encryptedData)` sync + `ipfs.add(CAR)` async via `waitUntil`
- `lib/s3.js` parametrizado: `R2_S3_ENDPOINT` o `VAULT_BUCKET` binding

**Read fallback (garantiza acceso sin CF):**
- R2 -> CF IPFS Gateway (`cf-ipfs.com`) -> public gateways (`w3s.link`, `dweb.link`) -> Filecoin retrieval
- `lib/storage/index.js` como port, composite fallback

**D1 schema:**
```sql
CREATE TABLE users (
  wallet_address TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  form_data TEXT
);

CREATE TABLE nonces (
  wallet_address TEXT NOT NULL,
  nonce TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE TABLE vaults_meta (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL REFERENCES users(wallet_address),
  cid TEXT UNIQUE NOT NULL,
  price TEXT DEFAULT '0',
  integrity_hash TEXT,
  commitment TEXT,
  pqc INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL REFERENCES users(wallet_address),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used INTEGER
);

CREATE INDEX idx_vaults_owner ON vaults_meta(owner);
CREATE INDEX idx_nonces_expires ON nonces(expires_at);
```

### Layer 3: Vinculacion wallet->dato (core)

**Flujo extremo a extremo:**
```
StarknetKit connect
  -> POST /api/auth/challenge {address}
  -> wallet.account.signMessage(typedData)
  -> POST /api/auth/login {address, signature, typedData}
  -> JWT {sub: address}
  -> POST /api/vaults {cid, price, claimSecret}
     -> generateListing (encrypt + wrap key)
     -> R2.put(cid, encryptedData)
     -> INSERT vaults_meta {owner: payload.sub}
     -> FileVault.lock {cidFelt, commitment, integrityHash, pqc}
  -> GET /api/vaults?owner=me
     -> D1 WHERE owner = payload.sub
  -> GET /api/vaults/:cid
     -> D1 + readLock verify
```

**Buy side:**
```
GET /api/vaults/:cid -> D1 + readLock
  -> STRK20 batchPrivateTransfer (99% seller / 1% pool)
  -> POST /api/claim {cid, claimSecret}
     -> recoverListing -> R2.get + decrypt
```

**API keys para agentes (futuro OpenSea Tools):**
```
POST /api/keys {keyName} -> D1 INSERT -> ak_...
  -> x-api-key header para S3 presigned URLs
  -> POST /tools/invoke {action, params} (futuro)
```

---

## Files to modify/create

| Archivo | Accion | Descripcion |
|---|---|---|
| `wrangler.toml` | EDIT | D1 binding + R2 binding + compat_date |
| `package.json` | EDIT | ya limpio (duplicates removed) |
| `lib/crypto/cid.js` | NEW | CIDv1 generator |
| `pages/api/auth/challenge.js` | NEW | SNIP-12 challenge + nonce D1 |
| `pages/api/auth/login.js` | NEW | AA validation + JWT |
| `pages/api/auth/verify.js` | NEW | JWT middleware helper |
| `lib/s3.js` | EDIT | parametrizar R2 vs Fil One |
| `pages/api/upload.js` | EDIT | JWT auth + CID real + D1 insert |
| `pages/api/download.js` | EDIT | JWT auth + fallback gateways |
| `schema.sql` | NEW | D1 migrations |
| `.env.example` | EDIT | JWT_SECRET, STARKNET_RPC_URL vars |

## Verification

1. `npx wrangler dev` -> challenge -> login -> JWT decode `sub == address`
2. Upload -> R2 head(cid) existe -> D1 `owner == payload.sub`
3. `curl -H "Authorization: Bearer $JWT" http://localhost:8787/api/vaults?owner=me` -> returns vaults
4. `npm run build` OK
5. Gateway fallback: `https://cf-ipfs.com/ipfs/bafy...` resuelve

## Out of scope
- TEE CoCo compute
- OpenSea Tools integration
- P2P instalable local
- Incentivo PoSt
- Mercado agentes IA

# DataVault: Marketplace Descentralizado de Datos Privados

## Valor Core
Un marketplace donde cualquiera puede monetizar datos privados en blockchain con transacciones anónimas, sin intermediarios ni costos ocultos.

## Cómo Funciona
Los usuarios vinculan su wallet Starknet (Braavos/Argent) y suben datos encriptados localmente a IPFS. El vendedor registra solo el CID y precio en el smart contract STRK20 (sin listar públicamente). El comprador accede mediante CID directo, realiza la compra anónima vía ZK-proofs, y recibe automáticamente la clave de desencriptación en el evento blockchain privado. Los datos quedan encriptados en IPFS, descifrables solo con la clave que el contrato entrega al comprador verificado.

## Tecnología
- **Blockchain:** Starknet + STRK20 (pagos privados por ZK-proofs)
- **Storage:** IPFS/Web3.Storage (datos encriptados end-to-end, permanentes)
- **Encriptación:** AES-256-GCM (cliente-side)
- **Frontend:** Next.js + @starknet-react
- **Smart Contract:** Cairo (registro por CID, compra anónima, entrega de claves)
- **Privacidad:** 
  - Vendedor: No aparece en listados (solo CID compartible)
  - Comprador: Transacción oculta por ZK-proofs
  - Datos: Encriptados en IPFS, descifrables solo con clave del contrato

## Roadmap Futuro
Fase 1 (Actual): CID directo (máxima privacidad)
Fase 2: Marketplace de listados con filtros por industria (menos privado, mayor descubrimiento)

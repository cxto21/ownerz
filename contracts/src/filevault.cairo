// contracts/src/filevault.cairo
// FileVault v2 — Marketplace contract that uses KeyExchangeMockup
// Requires KeyExchangeMockup deployed and address in constructor

#[starknet::contract]
pub mod FileVault {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::storage::Map;
    use starknet::storage::StorageMapReadAccess;
    use starknet::storage::StorageMapWriteAccess;
    use starknet::storage::StoragePointerReadAccess;
    use starknet::storage::StoragePointerWriteAccess;

    // ─── KeyExchangeMockup Dispatcher ───────────────────────
    #[starknet::interface]
    trait IKeyExchangeMockup<TContractState> {
        fn lock(
            ref self: TContractState,
            identifier: felt252,
            commitment: felt252,
            integrity_hash: felt252,
        );
        fn unlock(
            ref self: TContractState,
            identifier: felt252,
            proof: u16,
        );
        fn read_lock(
            self: @TContractState,
            identifier: felt252,
        ) -> LockState;
    }

    // ─── IERC20 (STRK token) ────────────────────────────────
    #[starknet::interface]
    trait IERC20<TContractState> {
        fn transfer_from(
            ref self: TContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool;
        fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    }

    // ─── LockState (re-export from key_onchain) ──────────────
    #[derive(Drop, Copy, Serde, starknet::Store)]
    pub struct LockState {
        pub commitment: felt252,
        pub integrity_hash: felt252,
        pub is_claimed: bool,
    }

    // ─── Storage ────────────────────────────────────────────
    #[storage]
    struct Storage {
        vaults: Map::<felt252, Vault>,
        platform_fee: u256,
        platform_wallet: ContractAddress,
        strk_token: ContractAddress,
        total_fees: u256,
        key_exchange: ContractAddress,
    }

    #[derive(Drop, Copy, Serde, starknet::Store)]
    pub struct Vault {
        pub seller: ContractAddress,
        pub price: u256,
        pub status: felt252,
        pub created_at: u64,
        pub ttl: u64,
        pub pqc: felt252,
        pub platform_fee_bps: u16,
        pub token_gate: ContractAddress,
        pub file_cid: felt252,
    }

    // ─── Events ─────────────────────────────────────────────
    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        VaultCreated: VaultCreated,
        KeyClaimed: KeyClaimed,
        VaultRefunded: VaultRefunded,
    }

    #[derive(Drop, starknet::Event)]
    struct VaultCreated {
        cid: felt252,
        seller: ContractAddress,
        price: u256,
        created_at: u64,
        ttl: u64,
        file_cid: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct KeyClaimed {
        cid: felt252,
        claimer: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct VaultRefunded {
        cid: felt252,
        seller: ContractAddress,
    }

    // ─── Constants ──────────────────────────────────────────
    const STATUS_ACTIVE: felt252 = 0;
    const STATUS_CLAIMED: felt252 = 1;
    const STATUS_REFUNDED: felt252 = 2;
    const MIN_PRICE: u256 = 1;
    const MIN_TTL: u64 = 1;
    const PLATFORM_FEE_BPS: u16 = 100; // 1%

    // ─── Errors ─────────────────────────────────────────────
    const ERR_VAULT_EXISTS: felt252 = 'VAULT_EXISTS';
    const ERR_VAULT_NOT_FOUND: felt252 = 'VAULT_NOT_FOUND';
    const ERR_ALREADY_CLAIMED: felt252 = 'ALREADY_CLAIMED';
    const ERR_ALREADY_REFUNDED: felt252 = 'ALREADY_REFUNDED';
    const ERR_NOT_SELLER: felt252 = 'NOT_SELLER';
    const ERR_REFUND_TOO_EARLY: felt252 = 'REFUND_TOO_EARLY';
    const ERR_INVALID_PRICE: felt252 = 'INVALID_PRICE';
    const ERR_INVALID_TTL: felt252 = 'INVALID_TTL';
    const ERR_FEE_TRANSFER_FAILED: felt252 = 'FEE_TRANSFER_FAILED';

    // ─── Constructor ────────────────────────────────────────
    #[constructor]
    fn constructor(
        ref self: ContractState,
        platform_wallet: ContractAddress,
        platform_fee: u256,
        strk_token: ContractAddress,
        key_exchange: ContractAddress,
        pqc: felt252,
        platform_fee_bps: u16,
    ) {
        self.platform_wallet.write(platform_wallet);
        self.platform_fee.write(platform_fee);
        self.strk_token.write(strk_token);
        self.key_exchange.write(key_exchange);
        // Initialize default values for new fields (will be set per-vault in create_vault)
    }

    // ─── IFileVault Interface ─────────────────────────────────
    #[starknet::interface]
    pub trait IFileVault<TContractState> {
        fn create_vault(
            ref self: TContractState,
            cid: felt252,
            price: u256,
            integrity_hash: felt252,
            commitment: felt252,
            ttl: u64,
            pqc: felt252,
            token_gate: ContractAddress,
            file_cid: felt252,
        );
        fn claim_vault(ref self: TContractState, cid: felt252, claim_secret: u16);
        fn refund_vault(ref self: TContractState, cid: felt252);
        fn get_vault(self: @TContractState, cid: felt252) -> (Vault, LockState);
        fn get_status(self: @TContractState, cid: felt252) -> felt252;
        fn get_price(self: @TContractState, cid: felt252) -> u256;
        fn get_platform_fee(self: @TContractState) -> u256;
        fn get_total_fees(self: @TContractState) -> u256;
    }

    // ─── External Impl ─────────────────────────────────────
    #[abi(embed_v0)]
    impl IFileVaultImpl of IFileVault<ContractState> {
        fn create_vault(
            ref self: ContractState,
            cid: felt252,
            price: u256,
            integrity_hash: felt252,
            commitment: felt252,
            ttl: u64,
            pqc: felt252,
            token_gate: ContractAddress,
            file_cid: felt252,
        ) {
            assert(price >= MIN_PRICE, ERR_INVALID_PRICE);
            assert(ttl >= MIN_TTL, ERR_INVALID_TTL);

            let existing = self.vaults.read(cid);
            let zero_addr: ContractAddress = 0.try_into().unwrap();
            assert(existing.seller == zero_addr, ERR_VAULT_EXISTS);

            // Pull fee from caller via ERC20 transferFrom
            let caller = get_caller_address();
            let fee = self.platform_fee.read();
            let token_addr = self.strk_token.read();
            let token = IERC20Dispatcher { contract_address: token_addr };
            let ok = token.transfer_from(caller, self.platform_wallet.read(), fee);
            assert(ok, ERR_FEE_TRANSFER_FAILED);

            // Track accumulated fees
            let current_total = self.total_fees.read();
            self.total_fees.write(current_total + fee);

            let now = starknet::get_block_timestamp();

            let vault = Vault {
                seller: caller,
                price,
                status: STATUS_ACTIVE,
                created_at: now,
                ttl,
                pqc,
                platform_fee_bps: PLATFORM_FEE_BPS,
                token_gate,
                file_cid,
            };
            self.vaults.write(cid, vault);

            // Delegate to KeyExchangeMockup
            let key_exchange_addr = self.key_exchange.read();
            let kex = IKeyExchangeMockupDispatcher { contract_address: key_exchange_addr };
            kex.lock(cid, commitment, integrity_hash);

            self.emit(VaultCreated {
                cid,
                seller: caller,
                price,
                created_at: now,
                ttl,
                file_cid,
            });
        }

        fn claim_vault(ref self: ContractState, cid: felt252, claim_secret: u16) {
            let vault = self.vaults.read(cid);
            let zero_addr: ContractAddress = 0.try_into().unwrap();
            assert(vault.seller != zero_addr, ERR_VAULT_NOT_FOUND);
            assert(vault.status == STATUS_ACTIVE, ERR_ALREADY_CLAIMED);

            // Token gate check: if token_gate is set, claimer must hold ≥1 token
            let claimer = get_caller_address();
            if vault.token_gate != zero_addr {
                let gate_token = IERC20Dispatcher { contract_address: vault.token_gate };
                let balance = gate_token.balance_of(claimer);
                assert(balance >= u256 { low: 1, high: 0 }, 'INSUFFICIENT_TOKEN_BALANCE');
            }

            // Delegate to KeyExchangeMockup — will panic with INVALID_PROOF if wrong secret
            let key_exchange_addr = self.key_exchange.read();
            let kex = IKeyExchangeMockupDispatcher { contract_address: key_exchange_addr };
            kex.unlock(cid, claim_secret);

            let mut updated = vault;
            updated.status = STATUS_CLAIMED;
            self.vaults.write(cid, updated);

            self.emit(KeyClaimed { cid, claimer });
        }

        fn refund_vault(ref self: ContractState, cid: felt252) {
            let vault = self.vaults.read(cid);
            let zero_addr: ContractAddress = 0.try_into().unwrap();
            assert(vault.seller != zero_addr, ERR_VAULT_NOT_FOUND);
            assert(vault.status == STATUS_ACTIVE, ERR_ALREADY_REFUNDED);

            let caller = get_caller_address();
            assert(caller == vault.seller, ERR_NOT_SELLER);

            let now = starknet::get_block_timestamp();
            let unlock_time = vault.created_at + vault.ttl;
            assert(now >= unlock_time, ERR_REFUND_TOO_EARLY);

            let mut updated = vault;
            updated.status = STATUS_REFUNDED;
            self.vaults.write(cid, updated);

            self.emit(VaultRefunded { cid, seller: caller });
        }

        fn get_vault(self: @ContractState, cid: felt252) -> (Vault, LockState) {
            let vault = self.vaults.read(cid);
            let zero_addr: ContractAddress = 0.try_into().unwrap();
            assert(vault.seller != zero_addr, ERR_VAULT_NOT_FOUND);

            // Read lock state from KeyExchangeMockup
            let key_exchange_addr = self.key_exchange.read();
            let kex = IKeyExchangeMockupDispatcher { contract_address: key_exchange_addr };
            let lock_state = kex.read_lock(cid);

            (vault, lock_state)
        }

        fn get_status(self: @ContractState, cid: felt252) -> felt252 {
            let vault = self.vaults.read(cid);
            let zero_addr: ContractAddress = 0.try_into().unwrap();
            assert(vault.seller != zero_addr, ERR_VAULT_NOT_FOUND);
            vault.status
        }

        fn get_price(self: @ContractState, cid: felt252) -> u256 {
            let vault = self.vaults.read(cid);
            let zero_addr: ContractAddress = 0.try_into().unwrap();
            assert(vault.seller != zero_addr, ERR_VAULT_NOT_FOUND);
            vault.price
        }

        fn get_platform_fee(self: @ContractState) -> u256 {
            self.platform_fee.read()
        }

        fn get_total_fees(self: @ContractState) -> u256 {
            self.total_fees.read()
        }
    }
}

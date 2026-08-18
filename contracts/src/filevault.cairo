use starknet::ContractAddress;
use starknet::get_caller_address;

#[starknet::contract]
mod FileVault {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use core::pedersen::pedersen;

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

    // ─── Storage ────────────────────────────────────────────
    #[storage]
    struct Storage {
        vaults: LegacyMap::<felt252, Vault>,
        platform_fee: u256,
        platform_wallet: ContractAddress,
        strk_token: ContractAddress,
        total_fees: u256,
    }

    #[derive(Drop, Copy, Serde, starknet::Store)]
    struct Vault {
        seller: ContractAddress,
        price: u256,
        key_seed_ciphertext: felt252,
        commitment: felt252,
        status: felt252,
        created_at: u64,
        ttl: u64,
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

    // ─── Errors ─────────────────────────────────────────────
    const ERR_VAULT_EXISTS: felt252 = 'VAULT_EXISTS';
    const ERR_VAULT_NOT_FOUND: felt252 = 'VAULT_NOT_FOUND';
    const ERR_ALREADY_CLAIMED: felt252 = 'ALREADY_CLAIMED';
    const ERR_ALREADY_REFUNDED: felt252 = 'ALREADY_REFUNDED';
    const ERR_INVALID_SECRET: felt252 = 'INVALID_SECRET';
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
    ) {
        self.platform_wallet.write(platform_wallet);
        self.platform_fee.write(platform_fee);
        self.strk_token.write(strk_token);
    }

    // ─── External Functions ─────────────────────────────────

    /// Create a new vault. Pulls platform_fee STRK from caller via ERC20 transferFrom.
    /// Frontend batches approve + create_vault in one multicall = one wallet popup.
    #[external(v0)]
    fn create_vault(
        ref self: ContractState,
        cid: felt252,
        price: u256,
        key_seed_ciphertext: felt252,
        commitment: felt252,
        ttl: u64,
    ) {
        assert(price >= MIN_PRICE, ERR_INVALID_PRICE);
        assert(ttl >= MIN_TTL, ERR_INVALID_TTL);

        let existing = self.vaults.read(cid);
        let zero_addr: ContractAddress = starknet::contract_address_const::<0>();
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
            key_seed_ciphertext,
            commitment,
            status: STATUS_ACTIVE,
            created_at: now,
            ttl,
        };
        self.vaults.write(cid, vault);

        self.emit(VaultCreated {
            cid,
            seller: caller,
            price,
            created_at: now,
            ttl,
        });
    }

    /// Claim a vault by providing the correct claim_secret.
    #[external(v0)]
    fn claim_vault(ref self: ContractState, cid: felt252, claim_secret: u16) {
        let vault = self.vaults.read(cid);
        let zero_addr: ContractAddress = starknet::contract_address_const::<0>();
        assert(vault.seller != zero_addr, ERR_VAULT_NOT_FOUND);
        assert(vault.status == STATUS_ACTIVE, ERR_ALREADY_CLAIMED);

        let computed = _compute_commitment(cid, claim_secret);
        assert(computed == vault.commitment, ERR_INVALID_SECRET);

        let mut updated = vault;
        updated.status = STATUS_CLAIMED;
        self.vaults.write(cid, updated);

        let claimer = get_caller_address();
        self.emit(KeyClaimed { cid, claimer });
    }

    /// Refund a vault after TTL expires. Only seller can call.
    #[external(v0)]
    fn refund_vault(ref self: ContractState, cid: felt252) {
        let vault = self.vaults.read(cid);
        let zero_addr: ContractAddress = starknet::contract_address_const::<0>();
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

    // ─── View Functions ─────────────────────────────────────

    /// Get full vault info. Reverts if not found.
    #[external(v0)]
    fn get_vault(self: @ContractState, cid: felt252) -> Vault {
        let vault = self.vaults.read(cid);
        let zero_addr: ContractAddress = starknet::contract_address_const::<0>();
        assert(vault.seller != zero_addr, ERR_VAULT_NOT_FOUND);
        vault
    }

    /// Get vault status (0=Active, 1=Claimed, 2=Refunded). Reverts if not found.
    #[external(v0)]
    fn get_status(self: @ContractState, cid: felt252) -> felt252 {
        let vault = self.vaults.read(cid);
        let zero_addr: ContractAddress = starknet::contract_address_const::<0>();
        assert(vault.seller != zero_addr, ERR_VAULT_NOT_FOUND);
        vault.status
    }

    /// Get vault price. Reverts if not found.
    #[external(v0)]
    fn get_price(self: @ContractState, cid: felt252) -> u256 {
        let vault = self.vaults.read(cid);
        let zero_addr: ContractAddress = starknet::contract_address_const::<0>();
        assert(vault.seller != zero_addr, ERR_VAULT_NOT_FOUND);
        vault.price
    }

    /// Get platform fee
    #[external(v0)]
    fn get_platform_fee(self: @ContractState) -> u256 {
        self.platform_fee.read()
    }

    /// Get accumulated fees
    #[external(v0)]
    fn get_total_fees(self: @ContractState) -> u256 {
        self.total_fees.read()
    }

    // ─── Internal Helpers ───────────────────────────────────

    /// Compute commitment: pedersen(cid, high_byte, low_byte)
    fn _compute_commitment(cid: felt252, claim_secret: u16) -> felt252 {
        let high: felt252 = ((claim_secret / 256) & 0xFF).into();
        let low: felt252 = ((claim_secret) & 0xFF).into();
        pedersen(pedersen(cid, high), low)
    }
}

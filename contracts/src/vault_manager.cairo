// contracts/src/vault_manager.cairo
// VaultManager — STRK20-powered privacy-first access control
//
// Flow:
//   1. Owner registers vault (calls AccessFactory.create_token → deploys AccessToken)
//   2. VaultManager becomes owner of the AccessToken
//   3. Buyer calls strk20InvokeTransaction with invoke to VaultManager.mint_access
//   4. STRK20 pool calls VaultManager atomically → mints token to buyer
//   5. Token is shielded in the same atomic tx
//
// Seller never touches contracts — just uses Ready/STRK20.
// Buyer pays via STRK20 → pool calls VaultManager → token minted atomically.

#[starknet::contract]
pub mod VaultManager {
    use core::num::traits::Zero;
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::storage::Map;
    use starknet::storage::StorageMapReadAccess;
    use starknet::storage::StorageMapWriteAccess;
    use starknet::storage::StoragePointerReadAccess;
    use starknet::storage::StoragePointerWriteAccess;
    use starknet::SyscallResultTrait;

    const ERR_NOT_POOL: felt252 = 'ONLY_POOL';
    const ERR_NOT_OWNER: felt252 = 'NOT_OWNER';
    const ERR_VAULT_NOT_FOUND: felt252 = 'VAULT_NOT_FOUND';
    const ERR_ZERO_ADDRESS: felt252 = 'ZERO_ADDRESS';
    const ERR_VAULT_EXISTS: felt252 = 'VAULT_EXISTS';
    const ERR_NO_FACTORY: felt252 = 'NO_FACTORY';

    #[storage]
    struct Storage {
        // STRK20 pool — only this address can call mint_access
        pool_address: ContractAddress,
        // AccessFactory — deploys AccessToken contracts
        access_factory: ContractAddress,
        // Owner — can register vaults and update config
        owner: ContractAddress,
        // Vault registry: vault_id → VaultConfig
        vaults: Map<felt252, VaultConfig>,
        // Access tracking: (vault_id, recipient) → bool
        access_granted: Map<(felt252, ContractAddress), bool>,
        // Vault count for enumeration
        vault_count: u64,
        // vault_id by index
        vault_ids: Map<u64, felt252>,
    }

    #[derive(Copy, Drop, Serde, starknet::Store)]
    struct VaultConfig {
        filevault: ContractAddress,      // FileVault contract holding the file
        token_address: ContractAddress,  // AccessToken contract for this vault
        price: u256,                     // Price in STRK wei
        duration: u64,                   // Access duration (0 = forever)
        seller: ContractAddress,         // Seller address
        active: bool,                    // Whether vault is active
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        AccessMinted: AccessMinted,
        VaultRegistered: VaultRegistered,
        ConfigUpdated: ConfigUpdated,
    }

    #[derive(Drop, starknet::Event)]
    struct AccessMinted {
        #[key]
        vault_id: felt252,
        #[key]
        recipient: ContractAddress,
        token_address: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct VaultRegistered {
        #[key]
        vault_id: felt252,
        #[key]
        seller: ContractAddress,
        token_address: ContractAddress,
        price: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct ConfigUpdated {
        field: felt252,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        pool_address: ContractAddress,
        access_factory: ContractAddress,
        owner: ContractAddress,
    ) {
        assert(pool_address.is_non_zero(), ERR_ZERO_ADDRESS);
        assert(access_factory.is_non_zero(), ERR_ZERO_ADDRESS);
        assert(owner.is_non_zero(), ERR_ZERO_ADDRESS);
        self.pool_address.write(pool_address);
        self.access_factory.write(access_factory);
        self.owner.write(owner);
    }

    #[starknet::interface]
    pub trait IVaultManager<TContractState> {
        // ─── Core (called by STRK20 pool atomically) ───
        fn mint_access(ref self: TContractState, vault_id: felt252, recipient: ContractAddress);
        // ─── Admin (owner only) ───
        fn register_vault(
            ref self: TContractState,
            vault_id: felt252,
            filevault: ContractAddress,
            token_name: felt252,
            token_symbol: felt252,
            price: u256,
            duration: u64,
        );
        // ─── View ───
        fn get_vault(self: @TContractState, vault_id: felt252) -> VaultConfig;
        fn get_vault_count(self: @TContractState) -> u64;
        fn has_access(self: @TContractState, vault_id: felt252, account: ContractAddress) -> bool;
        fn get_pool(self: @TContractState) -> ContractAddress;
        fn get_factory(self: @TContractState) -> ContractAddress;
        fn get_owner(self: @TContractState) -> ContractAddress;
        // ─── Config ───
        fn set_pool(ref self: TContractState, new_pool: ContractAddress);
        fn set_factory(ref self: TContractState, new_factory: ContractAddress);
    }

    #[abi(embed_v0)]
    impl IVaultManagerImpl of IVaultManager<ContractState> {
        /// Pool calls this atomically — mints AccessToken to recipient.
        /// Only callable by the STRK20 pool contract.
        fn mint_access(ref self: ContractState, vault_id: felt252, recipient: ContractAddress) {
            // Only pool can call this
            let caller = get_caller_address();
            assert(caller == self.pool_address.read(), ERR_NOT_POOL);
            assert(recipient.is_non_zero(), ERR_ZERO_ADDRESS);

            // Get vault config
            let config = self.vaults.read(vault_id);
            assert(config.active, ERR_VAULT_NOT_FOUND);
            assert(config.token_address.is_non_zero(), ERR_VAULT_NOT_FOUND);

            // Idempotent — skip if already granted
            let already = self.access_granted.read((vault_id, recipient));
            if already {
                return;
            }

            // Call AccessToken.mint_to(recipient)
            // VaultManager is the owner of the AccessToken (deployed via create_token)
            let token = config.token_address;
            let mut calldata = array![];
            calldata.append(recipient.into());
            starknet::syscalls::call_contract_syscall(
                token,
                selector!("mint_to"),
                calldata.span(),
            )
                .unwrap_syscall();

            // Track access
            self.access_granted.write((vault_id, recipient), true);

            self.emit(AccessMinted {
                vault_id,
                recipient,
                token_address: token,
            });
        }

        /// Owner registers a vault. Deploys AccessToken via AccessFactory.
        /// VaultManager becomes owner of the token → can mint_to later.
        fn register_vault(
            ref self: ContractState,
            vault_id: felt252,
            filevault: ContractAddress,
            token_name: felt252,
            token_symbol: felt252,
            price: u256,
            duration: u64,
        ) {
            let caller = get_caller_address();
            assert(caller == self.owner.read(), ERR_NOT_OWNER);
            assert(vault_id.is_non_zero(), ERR_ZERO_ADDRESS);

            let existing = self.vaults.read(vault_id);
            assert(!existing.active, ERR_VAULT_EXISTS);

            let factory = self.access_factory.read();
            assert(factory.is_non_zero(), ERR_NO_FACTORY);

            // Call AccessFactory.create_token(name, symbol, price, duration)
            // This deploys a new AccessToken where owner = VaultManager
            let mut calldata = array![];
            calldata.append(token_name);
            calldata.append(token_symbol);
            // price is u256 → low, high
            let price_low: felt252 = (price.low).into();
            let price_high: felt252 = (price.high).into();
            calldata.append(price_low);
            calldata.append(price_high);
            calldata.append(duration.into());

            let result = starknet::syscalls::call_contract_syscall(
                factory,
                selector!("create_token"),
                calldata.span(),
            )
                .unwrap_syscall();

            // Result is the deployed AccessToken address (felt252)
            let token_address: ContractAddress = (*result.at(0)).try_into().unwrap();

            let config = VaultConfig {
                filevault,
                token_address,
                price,
                duration,
                seller: caller,
                active: true,
            };
            self.vaults.write(vault_id, config);

            // Track for enumeration
            let idx = self.vault_count.read();
            self.vault_ids.write(idx, vault_id);
            self.vault_count.write(idx + 1);

            self.emit(VaultRegistered {
                vault_id,
                seller: caller,
                token_address,
                price,
            });
        }

        fn get_vault(self: @ContractState, vault_id: felt252) -> VaultConfig {
            self.vaults.read(vault_id)
        }
        fn get_vault_count(self: @ContractState) -> u64 {
            self.vault_count.read()
        }
        fn has_access(self: @ContractState, vault_id: felt252, account: ContractAddress) -> bool {
            self.access_granted.read((vault_id, account))
        }
        fn get_pool(self: @ContractState) -> ContractAddress {
            self.pool_address.read()
        }
        fn get_factory(self: @ContractState) -> ContractAddress {
            self.access_factory.read()
        }
        fn get_owner(self: @ContractState) -> ContractAddress {
            self.owner.read()
        }

        fn set_pool(ref self: ContractState, new_pool: ContractAddress) {
            assert(get_caller_address() == self.owner.read(), ERR_NOT_OWNER);
            self.pool_address.write(new_pool);
            self.emit(ConfigUpdated { field: 'pool' });
        }
        fn set_factory(ref self: ContractState, new_factory: ContractAddress) {
            assert(get_caller_address() == self.owner.read(), ERR_NOT_OWNER);
            self.access_factory.write(new_factory);
            self.emit(ConfigUpdated { field: 'factory' });
        }
    }
}

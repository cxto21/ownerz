// contracts/src/vault_manager.cairo
// VaultManager — STRK20-powered access control (no cross-contract calls)
//
// Flow:
//   1. Frontend calls AccessFactory.create_token → deploys AccessToken (owner = frontend wallet)
//   2. Frontend calls VaultManager.set_vault → stores config (no cross-contract call)
//   3. Buyer pays via STRK20 → pool calls VaultManager.mint_access → records access
//   4. Frontend calls AccessToken.mint_to(recipient) → mints token
//   5. Frontend shields the token
//
// VaultManager is a pure storage + access control contract.
// No cross-contract calls → deployable via Alchemy/Cartridge RPC.

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

    const ERR_NOT_POOL: felt252 = 'ONLY_POOL';
    const ERR_NOT_OWNER: felt252 = 'NOT_OWNER';
    const ERR_VAULT_NOT_FOUND: felt252 = 'VAULT_NOT_FOUND';
    const ERR_ZERO_ADDRESS: felt252 = 'ZERO_ADDRESS';
    const ERR_VAULT_EXISTS: felt252 = 'VAULT_EXISTS';

    #[storage]
    struct Storage {
        // STRK20 pool — only this address can call mint_access
        pool_address: ContractAddress,
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
    pub struct VaultConfig {
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
        owner: ContractAddress,
    ) {
        assert(pool_address.is_non_zero(), ERR_ZERO_ADDRESS);
        assert(owner.is_non_zero(), ERR_ZERO_ADDRESS);
        self.pool_address.write(pool_address);
        self.owner.write(owner);
    }

    #[starknet::interface]
    pub trait IVaultManager<TContractState> {
        // ─── Core (called by STRK20 pool atomically) ───
        fn mint_access(ref self: TContractState, vault_id: felt252, recipient: ContractAddress);
        // ─── Admin (owner only) ───
        fn set_vault(
            ref self: TContractState,
            vault_id: felt252,
            filevault: ContractAddress,
            token_address: ContractAddress,
            price: u256,
            duration: u64,
        );
        // ─── View ───
        fn get_vault(self: @TContractState, vault_id: felt252) -> VaultConfig;
        fn get_vault_count(self: @TContractState) -> u64;
        fn has_access(self: @TContractState, vault_id: felt252, account: ContractAddress) -> bool;
        fn get_pool(self: @TContractState) -> ContractAddress;
        fn get_owner(self: @TContractState) -> ContractAddress;
        // ─── Config ───
        fn set_pool(ref self: TContractState, new_pool: ContractAddress);
    }

    #[abi(embed_v0)]
    impl IVaultManagerImpl of IVaultManager<ContractState> {
        /// Pool calls this atomically — records access for recipient.
        /// Only callable by the STRK20 pool contract.
        /// No cross-contract call — just stores access_granted.
        fn mint_access(ref self: ContractState, vault_id: felt252, recipient: ContractAddress) {
            // Only pool can call this
            let caller = get_caller_address();
            assert(caller == self.pool_address.read(), ERR_NOT_POOL);
            assert(recipient.is_non_zero(), ERR_ZERO_ADDRESS);

            // Get vault config
            let config = self.vaults.read(vault_id);
            assert(config.active, ERR_VAULT_NOT_FOUND);

            // Idempotent — skip if already granted
            let already = self.access_granted.read((vault_id, recipient));
            if already {
                return;
            }

            // Track access (no cross-contract call)
            self.access_granted.write((vault_id, recipient), true);

            self.emit(AccessMinted {
                vault_id,
                recipient,
                token_address: config.token_address,
            });
        }

        /// Owner registers a vault. Frontend calls AccessFactory.create_token first,
        /// then passes the token_address here. No cross-contract call.
        fn set_vault(
            ref self: ContractState,
            vault_id: felt252,
            filevault: ContractAddress,
            token_address: ContractAddress,
            price: u256,
            duration: u64,
        ) {
            let caller = get_caller_address();
            assert(caller == self.owner.read(), ERR_NOT_OWNER);
            assert(vault_id.is_non_zero(), ERR_ZERO_ADDRESS);

            let existing = self.vaults.read(vault_id);
            assert(!existing.active, ERR_VAULT_EXISTS);

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
        fn get_owner(self: @ContractState) -> ContractAddress {
            self.owner.read()
        }

        fn set_pool(ref self: ContractState, new_pool: ContractAddress) {
            assert(get_caller_address() == self.owner.read(), ERR_NOT_OWNER);
            self.pool_address.write(new_pool);
            self.emit(ConfigUpdated { field: 'pool' });
        }
    }
}

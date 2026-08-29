// contracts/src/access_token.cairo
// AccessToken — ERC20 soulbound (1 token = access), shieldable via STRK20
// Price (u256, 0=free) and duration (u64, 0=forever) with per-holder expiry map.
// Soulbound via ERC20Hooks: only mint (from=0) and burn (to=0) allowed, transfers blocked.
// Refactored to use OpenZeppelin ERC20Component (audited) with soulbound hook.
// has_access = balance>0 && !is_expired

#[starknet::contract]
pub mod AccessToken {
    use core::num::traits::Zero;
    use openzeppelin_token::erc20::{DefaultConfig, ERC20Component};
    use starknet::ContractAddress;
    use starknet::get_block_timestamp;
    use starknet::get_caller_address;
    use starknet::storage::Map;
    use starknet::storage::StorageMapReadAccess;
    use starknet::storage::StorageMapWriteAccess;
    use starknet::storage::StoragePointerReadAccess;
    use starknet::storage::StoragePointerWriteAccess;

    component!(path: ERC20Component, storage: erc20, event: ERC20Event);

    // ERC20 Mixin — audited OZ implementation (includes IERC20 + IERC20Metadata + camelCase)
    #[abi(embed_v0)]
    impl ERC20MixinImpl = ERC20Component::ERC20MixinImpl<ContractState>;
    impl ERC20InternalImpl = ERC20Component::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        erc20: ERC20Component::Storage,
        // Access catalog fields
        price: u256,
        duration: u64,
        expiry: Map<ContractAddress, u64>,
        owner: ContractAddress,
        // STRK20 pool whitelist — transfers to this address are allowed (shield/unshield)
        shield_pool: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        ERC20Event: ERC20Component::Event,
        AccessMinted: AccessMinted,
        PriceUpdated: PriceUpdated,
        DurationUpdated: DurationUpdated,
    }

    #[derive(Drop, starknet::Event)]
    struct AccessMinted {
        #[key]
        to: ContractAddress,
        expiry: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct PriceUpdated {
        old_price: u256,
        new_price: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct DurationUpdated {
        old_duration: u64,
        new_duration: u64,
    }

    // Soulbound hook — mint (from=0), burn (to=0), or transfer to STRK20 pool allowed
    impl ERC20HooksImpl of ERC20Component::ERC20HooksTrait<ContractState> {
        fn before_update(
            ref self: ERC20Component::ComponentState<ContractState>,
            from: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) {
            // Allow mint (from=0), burn (to=0), or transfer to STRK20 pool (shield)
            let pool = self.shield_pool.read();
            let is_pool = pool.is_non_zero() && recipient == pool;
            assert(from.is_zero() || recipient.is_zero() || is_pool, 'SOULBOUND');
        }
    }

    const ERR_NOT_OWNER: felt252 = 'NOT_OWNER';
    const ERR_ZERO_ADDRESS: felt252 = 'ZERO_ADDRESS';

    #[constructor]
    fn constructor(
        ref self: ContractState,
        name: felt252,
        symbol: felt252,
        price: u256,
        duration: u64,
        owner: ContractAddress,
        shield_pool: ContractAddress,
    ) {
        // Convert felt252 short string to ByteArray with correct length
        let mut name_ba: ByteArray = Default::default();
        let name_len = felt252_short_string_len(name);
        name_ba.append_word(name, name_len);
        let mut symbol_ba: ByteArray = Default::default();
        let symbol_len = felt252_short_string_len(symbol);
        symbol_ba.append_word(symbol, symbol_len);
        self.erc20.initializer(name_ba, symbol_ba);
        self.price.write(price);
        self.duration.write(duration);
        self.owner.write(owner);
        self.shield_pool.write(shield_pool);
    }

    // ─── IAccessToken Interface (access catalog only; ERC20 via OZ mixin) ───
    #[starknet::interface]
    pub trait IAccessToken<TContractState> {
        fn get_price(self: @TContractState) -> u256;
        fn get_duration(self: @TContractState) -> u64;
        fn get_expiry(self: @TContractState, account: ContractAddress) -> u64;
        fn has_access(self: @TContractState, account: ContractAddress) -> bool;
        fn is_expired(self: @TContractState, account: ContractAddress) -> bool;
        fn get_owner(self: @TContractState) -> ContractAddress;
        fn get_shield_pool(self: @TContractState) -> ContractAddress;
        fn mint(ref self: TContractState);
        fn mint_to(ref self: TContractState, recipient: ContractAddress);
        fn set_price(ref self: TContractState, new_price: u256);
        fn set_duration(ref self: TContractState, new_duration: u64);
        fn set_shield_pool(ref self: TContractState, pool: ContractAddress);
    }

    #[abi(embed_v0)]
    impl IAccessTokenImpl of IAccessToken<ContractState> {
        fn get_price(self: @ContractState) -> u256 {
            self.price.read()
        }
        fn get_duration(self: @ContractState) -> u64 {
            self.duration.read()
        }
        fn get_expiry(self: @ContractState, account: ContractAddress) -> u64 {
            self.expiry.read(account)
        }
        fn has_access(self: @ContractState, account: ContractAddress) -> bool {
            let bal = self.erc20.ERC20_balances.read(account);
            if bal == 0 {
                return false;
            }
            !self.is_expired(account)
        }
        fn is_expired(self: @ContractState, account: ContractAddress) -> bool {
            let dur = self.duration.read();
            if dur == 0 {
                return false; // forever never expires
            }
            let exp = self.expiry.read(account);
            if exp == 0 {
                return true; // not minted yet => treat as expired, but has_access already false due bal==0
            }
            let now = get_block_timestamp();
            now >= exp
        }
        fn get_owner(self: @ContractState) -> ContractAddress {
            self.owner.read()
        }
        fn get_shield_pool(self: @ContractState) -> ContractAddress {
            self.shield_pool.read()
        }

        fn mint(ref self: ContractState) {
            let caller = get_caller_address();
            self._mint_to(caller);
        }
        fn mint_to(ref self: ContractState, recipient: ContractAddress) {
            let caller = get_caller_address();
            let owner = self.owner.read();
            assert(caller == owner, ERR_NOT_OWNER);
            self._mint_to(recipient);
        }

        fn set_price(ref self: ContractState, new_price: u256) {
            let caller = get_caller_address();
            assert(caller == self.owner.read(), ERR_NOT_OWNER);
            let old = self.price.read();
            self.price.write(new_price);
            self.emit(PriceUpdated { old_price: old, new_price });
        }
        fn set_duration(ref self: ContractState, new_duration: u64) {
            let caller = get_caller_address();
            assert(caller == self.owner.read(), ERR_NOT_OWNER);
            let old = self.duration.read();
            self.duration.write(new_duration);
            self.emit(DurationUpdated { old_duration: old, new_duration });
        }
        fn set_shield_pool(ref self: ContractState, pool: ContractAddress) {
            let caller = get_caller_address();
            assert(caller == self.owner.read(), ERR_NOT_OWNER);
            self.shield_pool.write(pool);
        }
    }

    // Helper to get byte length of felt252 short string (up to 31 bytes)
    // For short strings, length is number of non-zero bytes when viewed as big-endian
    fn felt252_short_string_len(value: felt252) -> usize {
        if value == 0 {
            return 0;
        }
        // Use u256 conversion to count bytes via division
        let mut v_u256: u256 = value.into();
        let mut n: usize = 0;
        let divisor: u256 = 256;
        loop {
            if v_u256 == 0 {
                break;
            }
            v_u256 = v_u256 / divisor;
            n += 1;
            if n == 31 {
                break;
            }
        };
        n
    }

    // ─── Internal helpers ─────────────────────────────────────
    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _mint_to(ref self: ContractState, recipient: ContractAddress) {
            assert(!recipient.is_zero(), ERR_ZERO_ADDRESS);
            let dur = self.duration.read();
            let now = get_block_timestamp();
            let new_expiry: u64 = if dur == 0 { 0 } else { now + dur };
            let bal = self.erc20.ERC20_balances.read(recipient);
            if bal == 0 {
                self.erc20.mint(recipient, 1);
                self.expiry.write(recipient, new_expiry);
                self.emit(AccessMinted { to: recipient, expiry: new_expiry });
            } else {
                // Already holder — renew expiry if time-bound
                if dur != 0 {
                    self.expiry.write(recipient, new_expiry);
                    self.emit(AccessMinted { to: recipient, expiry: new_expiry });
                }
            }
        }
    }
}

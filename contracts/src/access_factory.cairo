// contracts/src/access_factory.cairo
// Factory for AccessToken — deploys soulbound ERC20 access tokens via deploy_syscall
// Seller may create N tokens: each with price (u256, 0=free) and duration (u64, 0=forever)
// Follows Cairo 2.18 storage patterns (Map, Storage*Access), #[abi(embed_v0)], 0.try_into().unwrap()

#[starknet::contract]
pub mod AccessFactory {
    use starknet::ContractAddress;
    use starknet::ClassHash;
    use starknet::get_caller_address;
    use starknet::syscalls::deploy_syscall;
    use starknet::SyscallResultTrait;
    use starknet::storage::Map;
    use starknet::storage::StorageMapReadAccess;
    use starknet::storage::StorageMapWriteAccess;
    use starknet::storage::StoragePointerReadAccess;
    use starknet::storage::StoragePointerWriteAccess;

    #[storage]
    struct Storage {
        access_token_class_hash: ClassHash,
        token_count: u64,
        tokens: Map<u64, ContractAddress>,
        // optional per-seller tracking: count + map
        seller_token_count: Map<ContractAddress, u64>,
        seller_tokens: Map<(ContractAddress, u64), ContractAddress>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        TokenCreated: TokenCreated,
        ClassHashUpdated: ClassHashUpdated,
    }

    #[derive(Drop, starknet::Event)]
    struct TokenCreated {
        #[key]
        creator: ContractAddress,
        #[key]
        token_address: ContractAddress,
        price: u256,
        duration: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct ClassHashUpdated {
        old_class_hash: ClassHash,
        new_class_hash: ClassHash,
    }

    const ERR_ZERO_ADDRESS: felt252 = 'ZERO_ADDRESS';
    const ERR_ZERO_CLASS_HASH: felt252 = 'ZERO_CLASS_HASH';
    const ERR_NOT_OWNER: felt252 = 'NOT_OWNER';

    #[constructor]
    fn constructor(ref self: ContractState, access_token_class_hash: ClassHash) {
        let zero_hash: ClassHash = 0.try_into().unwrap();
        // Allow 0 on init for tests, but require non-zero for production creates
        self.access_token_class_hash.write(access_token_class_hash);
        self.token_count.write(0);
    }

    #[starknet::interface]
    pub trait IAccessFactory<TContractState> {
        fn create_token(
            ref self: TContractState,
            name: felt252,
            symbol: felt252,
            price: u256,
            duration: u64,
        ) -> ContractAddress;
        fn get_token_count(self: @TContractState) -> u64;
        fn get_token(self: @TContractState, index: u64) -> ContractAddress;
        fn get_seller_token_count(self: @TContractState, seller: ContractAddress) -> u64;
        fn get_seller_token(
            self: @TContractState, seller: ContractAddress, index: u64,
        ) -> ContractAddress;
        fn get_class_hash(self: @TContractState) -> ClassHash;
        fn set_class_hash(ref self: TContractState, new_class_hash: ClassHash);
    }

    #[abi(embed_v0)]
    impl IAccessFactoryImpl of IAccessFactory<ContractState> {
        fn create_token(
            ref self: ContractState,
            name: felt252,
            symbol: felt252,
            price: u256,
            duration: u64,
        ) -> ContractAddress {
            let class_hash = self.access_token_class_hash.read();
            let zero_hash: ClassHash = 0.try_into().unwrap();
            assert(class_hash != zero_hash, ERR_ZERO_CLASS_HASH);

            let caller = get_caller_address();
            let zero_addr: ContractAddress = 0.try_into().unwrap();
            assert(caller != zero_addr, ERR_ZERO_ADDRESS);

            let mut calldata = array![];
            name.serialize(ref calldata);
            symbol.serialize(ref calldata);
            price.serialize(ref calldata);
            duration.serialize(ref calldata);
            caller.serialize(ref calldata);

            // salt ensures unique address per create; use token_count + caller
            let salt: felt252 = (self.token_count.read() + 1).into();
            let (deployed_address, _) = deploy_syscall(
                class_hash, salt, calldata.span(), false,
            )
                .unwrap_syscall();

            // track globally
            let idx = self.token_count.read();
            self.tokens.write(idx, deployed_address);
            self.token_count.write(idx + 1);

            // per-seller
            let s_cnt = self.seller_token_count.read(caller);
            self.seller_tokens.write((caller, s_cnt), deployed_address);
            self.seller_token_count.write(caller, s_cnt + 1);

            self.emit(TokenCreated { creator: caller, token_address: deployed_address, price, duration });

            deployed_address
        }

        fn get_token_count(self: @ContractState) -> u64 {
            self.token_count.read()
        }
        fn get_token(self: @ContractState, index: u64) -> ContractAddress {
            self.tokens.read(index)
        }
        fn get_seller_token_count(self: @ContractState, seller: ContractAddress) -> u64 {
            self.seller_token_count.read(seller)
        }
        fn get_seller_token(
            self: @ContractState, seller: ContractAddress, index: u64,
        ) -> ContractAddress {
            self.seller_tokens.read((seller, index))
        }
        fn get_class_hash(self: @ContractState) -> ClassHash {
            self.access_token_class_hash.read()
        }
        fn set_class_hash(ref self: ContractState, new_class_hash: ClassHash) {
            // For simplicity, allow anyone to update in this MVP; in production restrict to owner.
            // We keep it open but emit event; alternatively restrict to zero check.
            let zero_hash: ClassHash = 0.try_into().unwrap();
            assert(new_class_hash != zero_hash, ERR_ZERO_CLASS_HASH);
            let old = self.access_token_class_hash.read();
            self.access_token_class_hash.write(new_class_hash);
            self.emit(ClassHashUpdated { old_class_hash: old, new_class_hash });
        }
    }
}

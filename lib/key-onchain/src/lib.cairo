// lib/key-onchain/src/lib.cairo
// Key Onchain Library — MOCKUP v0

use starknet::ContractAddress;
use starknet::get_caller_address;
use core::pedersen::pedersen;
use starknet::storage::Map;
use starknet::storage::StorageMapReadAccess;
use starknet::storage::StorageMapWriteAccess;

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct LockState {
    commitment: felt252,
    integrity_hash: felt252,
    is_claimed: bool,
}

#[starknet::interface]
pub trait IKeyExchange<TContractState> {
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

#[starknet::contract]
pub mod KeyExchangeMockup {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use core::pedersen::pedersen;
    use super::{LockState, IKeyExchange};
    use starknet::storage::Map;
    use starknet::storage::StorageMapReadAccess;
    use starknet::storage::StorageMapWriteAccess;

    #[storage]
    struct Storage {
        locks: Map::<felt252, LockState>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        LockCreated: LockCreated,
        LockClaimed: LockClaimed,
    }

    #[derive(Drop, starknet::Event)]
    struct LockCreated {
        identifier: felt252,
        caller: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct LockClaimed {
        identifier: felt252,
        claimer: ContractAddress,
    }

    const ERR_ALREADY_LOCKED: felt252 = 'ALREADY_LOCKED';
    const ERR_NOT_FOUND: felt252 = 'NOT_FOUND';
    const ERR_ALREADY_CLAIMED: felt252 = 'ALREADY_CLAIMED';
    const ERR_INVALID_PROOF: felt252 = 'INVALID_PROOF';

    #[constructor]
    fn constructor(ref self: ContractState) {}

    #[abi(embed_v0)]
    impl IKeyExchangeImpl of IKeyExchange<ContractState> {
        fn lock(
            ref self: ContractState,
            identifier: felt252,
            commitment: felt252,
            integrity_hash: felt252,
        ) {
            let existing = self.locks.read(identifier);
            assert(!existing.is_claimed, ERR_ALREADY_LOCKED);
            
            self.locks.write(identifier, LockState { 
                commitment, 
                integrity_hash, 
                is_claimed: false 
            });
            
            self.emit(LockCreated { identifier, caller: get_caller_address() });
        }

        fn unlock(
            ref self: ContractState,
            identifier: felt252,
            proof: u16,
        ) {
            let lock = self.locks.read(identifier);
            assert(lock.commitment != 0, ERR_NOT_FOUND);
            assert(!lock.is_claimed, ERR_ALREADY_CLAIMED);
            
            let computed = _compute_commitment(identifier, proof);
            assert(computed == lock.commitment, ERR_INVALID_PROOF);
            
            self.locks.write(identifier, LockState { 
                commitment: lock.commitment,
                integrity_hash: lock.integrity_hash,
                is_claimed: true 
            });
            
            self.emit(LockClaimed { identifier, claimer: get_caller_address() });
        }

        fn read_lock(
            self: @ContractState,
            identifier: felt252,
        ) -> LockState {
            self.locks.read(identifier)
        }
    }

    fn _compute_commitment(identifier: felt252, proof: u16) -> felt252 {
        let high: felt252 = ((proof / 256) & 0xFF).into();
        let low: felt252 = (proof & 0xFF).into();
        pedersen(pedersen(identifier, high), low)
    }
}
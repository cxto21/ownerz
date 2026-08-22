// contracts/src/tests.cairo
// FileVault v2 — snforge 0.61 dual-contract tests

use starknet::ContractAddress;
use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address,
    stop_cheat_caller_address, start_cheat_block_timestamp, stop_cheat_block_timestamp,
};
use crate::filevault::FileVault::{IFileVaultDispatcher, IFileVaultDispatcherTrait, Vault};
use crate::filevault::FileVault::LockState as FileVaultLockState;

// ---- Mock ERC20 (STRK) ----
#[starknet::interface]
trait IMockERC20<TContractState> {
    fn transfer_from(
        ref self: TContractState,
        sender: ContractAddress,
        recipient: ContractAddress,
        amount: u256,
    ) -> bool;
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
}

#[starknet::contract]
mod MockERC20 {
    use starknet::ContractAddress;
    use super::IMockERC20;
    #[storage]
    struct Storage {}
    #[constructor]
    fn constructor(ref self: ContractState) {}
    #[abi(embed_v0)]
    impl IMockERC20Impl of IMockERC20<ContractState> {
        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            true
        }
        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            0
        }
    }
}

// ---- Local KeyExchangeMockup (for tests) ----
// Duplicate of lib/key-onchain/src/lib.cairo to avoid dependency artifact issue
// Reuses FileVaultLockState so cross-contract dispatch matches FileVault
#[starknet::interface]
trait IKeyExchangeMockup<TContractState> {
    fn lock(
        ref self: TContractState,
        identifier: felt252,
        commitment: felt252,
        integrity_hash: felt252,
    );
    fn unlock(ref self: TContractState, identifier: felt252, proof: u16);
    fn read_lock(self: @TContractState, identifier: felt252) -> FileVaultLockState;
}

#[starknet::contract]
mod KeyExchangeMockup {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use core::pedersen::pedersen;
    use super::IKeyExchangeMockup;
    use crate::filevault::FileVault::LockState as FileVaultLockState;
    use starknet::storage::Map;
    use starknet::storage::StorageMapReadAccess;
    use starknet::storage::StorageMapWriteAccess;
    #[storage]
    struct Storage {
        locks: Map::<felt252, FileVaultLockState>,
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
    impl IKeyExchangeImpl of IKeyExchangeMockup<ContractState> {
        fn lock(
            ref self: ContractState,
            identifier: felt252,
            commitment: felt252,
            integrity_hash: felt252,
        ) {
            let existing = self.locks.read(identifier);
            assert(!existing.is_claimed, ERR_ALREADY_LOCKED);
            self.locks.write(identifier, FileVaultLockState { commitment, integrity_hash, is_claimed: false });
            self.emit(LockCreated { identifier, caller: get_caller_address() });
        }
        fn unlock(ref self: ContractState, identifier: felt252, proof: u16) {
            let lock = self.locks.read(identifier);
            assert(lock.commitment != 0, ERR_NOT_FOUND);
            assert(!lock.is_claimed, ERR_ALREADY_CLAIMED);
            let computed = _compute_commitment(identifier, proof);
            assert(computed == lock.commitment, ERR_INVALID_PROOF);
            self.locks.write(identifier, FileVaultLockState { commitment: lock.commitment, integrity_hash: lock.integrity_hash, is_claimed: true });
            self.emit(LockClaimed { identifier, claimer: get_caller_address() });
        }
        fn read_lock(self: @ContractState, identifier: felt252) -> FileVaultLockState {
            self.locks.read(identifier)
        }
    }
    fn _compute_commitment(identifier: felt252, proof: u16) -> felt252 {
        let high: felt252 = ((proof / 256) & 0xFF).into();
        let low: felt252 = (proof & 0xFF).into();
        pedersen(pedersen(identifier, high), low)
    }
}

// ---- Helpers ----

const CID: felt252 = 'test_cid_123';
const CID2: felt252 = 'test_cid_456';
const PRICE: u256 = 1000000000000000000; // 1 STRK
const CLAIM_SECRET: u16 = 0x1234;
const WRONG_SECRET: u16 = 0xFFFF;
const TTL: u64 = 2592000; // 30 days
const FEE: u256 = 500000000000000000; // 0.5 STRK

fn seller() -> ContractAddress {
    0x123.try_into().unwrap()
}
fn buyer() -> ContractAddress {
    0x456.try_into().unwrap()
}
fn platform_wallet() -> ContractAddress {
    0x789.try_into().unwrap()
}

fn compute_commitment(cid: felt252, claim_secret: u16) -> felt252 {
    let high: felt252 = ((claim_secret / 256) & 0xFF).into();
    let low: felt252 = (claim_secret & 0xFF).into();
    core::pedersen::pedersen(core::pedersen::pedersen(cid, high), low)
}

fn deploy_kex() -> ContractAddress {
    let kex_class = declare("KeyExchangeMockup").unwrap().contract_class();
    let (kex_address, _) = kex_class.deploy(@array![]).unwrap();
    kex_address
}

fn deploy_mock_erc20() -> ContractAddress {
    let erc20_class = declare("MockERC20").unwrap().contract_class();
    let (addr, _) = erc20_class.deploy(@array![]).unwrap();
    addr
}

fn deploy_filevault(kex_address: ContractAddress, mock_token: ContractAddress) -> ContractAddress {
    let fv_class = declare("FileVault").unwrap().contract_class();
    let mut calldata = array![];
    platform_wallet().serialize(ref calldata);
    FEE.serialize(ref calldata);
    mock_token.serialize(ref calldata);
    kex_address.serialize(ref calldata);
    let (fv_address, _) = fv_class.deploy(@calldata).unwrap();
    fv_address
}

fn setup() -> (IFileVaultDispatcher, ContractAddress, ContractAddress) {
    let kex = deploy_kex();
    let mock_token = deploy_mock_erc20();
    let fv_address = deploy_filevault(kex, mock_token);
    let fv = IFileVaultDispatcher { contract_address: fv_address };
    (fv, kex, mock_token)
}

// ---- Tests ----

#[test]
fn test_create_vault_success() {
    let (fv, _kex, _token) = setup();
    let commitment = compute_commitment(CID, CLAIM_SECRET);
    let integrity_hash: felt252 = 'hash123';

    start_cheat_caller_address(fv.contract_address, seller());
    fv.create_vault(CID, PRICE, integrity_hash, commitment, TTL);
    stop_cheat_caller_address(fv.contract_address);

    let (vault, lock) = fv.get_vault(CID);
    assert(vault.seller == seller(), 'wrong seller');
    assert(vault.price == PRICE, 'wrong price');
    assert(vault.status == 0, 'should be active');
    assert(vault.ttl == TTL, 'wrong ttl');
    // LockState delegated to KEX
    assert(lock.commitment == commitment, 'wrong commitment');
    assert(lock.integrity_hash == integrity_hash, 'wrong ih');
    assert(!lock.is_claimed, 'should not be claimed');
}

#[test]
#[should_panic(expected: 'VAULT_EXISTS')]
fn test_create_vault_duplicate() {
    let (fv, _kex, _token) = setup();
    let commitment = compute_commitment(CID, CLAIM_SECRET);
    let ih: felt252 = 'hash123';
    start_cheat_caller_address(fv.contract_address, seller());
    fv.create_vault(CID, PRICE, ih, commitment, TTL);
    // second should panic
    fv.create_vault(CID, PRICE, ih, commitment, TTL);
    stop_cheat_caller_address(fv.contract_address);
}

#[test]
#[should_panic(expected: 'INVALID_PRICE')]
fn test_create_vault_zero_price() {
    let (fv, _kex, _token) = setup();
    let commitment = compute_commitment(CID, CLAIM_SECRET);
    let ih: felt252 = 'hash123';
    start_cheat_caller_address(fv.contract_address, seller());
    fv.create_vault(CID, 0, ih, commitment, TTL);
    stop_cheat_caller_address(fv.contract_address);
}

#[test]
#[should_panic(expected: 'INVALID_TTL')]
fn test_create_vault_zero_ttl() {
    let (fv, _kex, _token) = setup();
    let commitment = compute_commitment(CID, CLAIM_SECRET);
    let ih: felt252 = 'hash123';
    start_cheat_caller_address(fv.contract_address, seller());
    fv.create_vault(CID, PRICE, ih, commitment, 0);
    stop_cheat_caller_address(fv.contract_address);
}

#[test]
fn test_claim_success() {
    let (fv, _kex, _token) = setup();
    let commitment = compute_commitment(CID, CLAIM_SECRET);
    let ih: felt252 = 'hash123';

    start_cheat_caller_address(fv.contract_address, seller());
    fv.create_vault(CID, PRICE, ih, commitment, TTL);
    stop_cheat_caller_address(fv.contract_address);

    start_cheat_caller_address(fv.contract_address, buyer());
    fv.claim_vault(CID, CLAIM_SECRET);
    stop_cheat_caller_address(fv.contract_address);

    let (vault, lock) = fv.get_vault(CID);
    assert(vault.status == 1, 'should be claimed');
    assert(lock.is_claimed, 'lock should be claimed');
}

#[test]
#[should_panic(expected: 'INVALID_PROOF')]
fn test_claim_wrong_secret() {
    let (fv, _kex, _token) = setup();
    let commitment = compute_commitment(CID, CLAIM_SECRET);
    let ih: felt252 = 'hash123';

    start_cheat_caller_address(fv.contract_address, seller());
    fv.create_vault(CID, PRICE, ih, commitment, TTL);
    stop_cheat_caller_address(fv.contract_address);

    start_cheat_caller_address(fv.contract_address, buyer());
    fv.claim_vault(CID, WRONG_SECRET);
    stop_cheat_caller_address(fv.contract_address);
}

#[test]
#[should_panic(expected: 'ALREADY_CLAIMED')]
fn test_double_claim_fails() {
    let (fv, _kex, _token) = setup();
    let commitment = compute_commitment(CID, CLAIM_SECRET);
    let ih: felt252 = 'hash123';

    start_cheat_caller_address(fv.contract_address, seller());
    fv.create_vault(CID, PRICE, ih, commitment, TTL);
    stop_cheat_caller_address(fv.contract_address);

    start_cheat_caller_address(fv.contract_address, buyer());
    fv.claim_vault(CID, CLAIM_SECRET);
    // second claim should panic with ALREADY_CLAIMED from FileVault (status check)
    fv.claim_vault(CID, CLAIM_SECRET);
    stop_cheat_caller_address(fv.contract_address);
}

#[test]
fn test_get_vault_tuple() {
    let (fv, _kex, _token) = setup();
    let commitment = compute_commitment(CID2, CLAIM_SECRET);
    let ih: felt252 = 'integrity_abc';

    start_cheat_caller_address(fv.contract_address, seller());
    fv.create_vault(CID2, PRICE, ih, commitment, TTL);
    stop_cheat_caller_address(fv.contract_address);

    let (vault, lock) = fv.get_vault(CID2);
    assert(vault.seller == seller(), 'seller mismatch');
    assert(vault.price == PRICE, 'price mismatch');
    assert(vault.status == 0, 'status mismatch');
    assert(lock.commitment == commitment, 'commitment mismatch');
    assert(lock.integrity_hash == ih, 'ih mismatch');
    assert(!lock.is_claimed, 'not claimed');
}

#[test]
fn test_get_platform_fee() {
    let (fv, _kex, _token) = setup();
    let fee = fv.get_platform_fee();
    assert(fee == FEE, 'wrong fee');
}

#[test]
fn test_get_total_fees_accumulates() {
    let (fv, _kex, _token) = setup();
    let commitment = compute_commitment(CID, CLAIM_SECRET);
    let ih: felt252 = 'hash123';
    let fee_before = fv.get_total_fees();
    assert(fee_before == 0, 'should start 0');

    start_cheat_caller_address(fv.contract_address, seller());
    fv.create_vault(CID, PRICE, ih, commitment, TTL);
    stop_cheat_caller_address(fv.contract_address);

    let fee_after = fv.get_total_fees();
    assert(fee_after == FEE, 'should be FEE after one vault');

    // second vault with different CID should add again
    let commitment2 = compute_commitment(CID2, CLAIM_SECRET);
    start_cheat_caller_address(fv.contract_address, seller());
    fv.create_vault(CID2, PRICE, ih, commitment2, TTL);
    stop_cheat_caller_address(fv.contract_address);

    let fee_after2 = fv.get_total_fees();
    assert(fee_after2 == FEE * 2, 'should be 2*FEE');
}

#[test]
fn test_refund_after_ttl() {
    let (fv, _kex, _token) = setup();
    let commitment = compute_commitment(CID, CLAIM_SECRET);
    let ih: felt252 = 'hash123';
    let short_ttl: u64 = 100;

    start_cheat_caller_address(fv.contract_address, seller());
    fv.create_vault(CID, PRICE, ih, commitment, short_ttl);
    stop_cheat_caller_address(fv.contract_address);

    // Warp time past TTL
    let now = starknet::get_block_timestamp();
    start_cheat_block_timestamp(fv.contract_address, now + short_ttl + 1);

    start_cheat_caller_address(fv.contract_address, seller());
    fv.refund_vault(CID);
    stop_cheat_caller_address(fv.contract_address);

    let (vault, _lock) = fv.get_vault(CID);
    assert(vault.status == 2, 'should be refunded');

    stop_cheat_block_timestamp(fv.contract_address);
}

#[test]
#[should_panic(expected: 'REFUND_TOO_EARLY')]
fn test_refund_too_early() {
    let (fv, _kex, _token) = setup();
    let commitment = compute_commitment(CID, CLAIM_SECRET);
    let ih: felt252 = 'hash123';

    start_cheat_caller_address(fv.contract_address, seller());
    fv.create_vault(CID, PRICE, ih, commitment, TTL);
    // immediate refund should fail
    fv.refund_vault(CID);
    stop_cheat_caller_address(fv.contract_address);
}

#[test]
#[should_panic(expected: 'NOT_SELLER')]
fn test_refund_not_seller() {
    let (fv, _kex, _token) = setup();
    let commitment = compute_commitment(CID, CLAIM_SECRET);
    let ih: felt252 = 'hash123';
    let short_ttl: u64 = 100;

    start_cheat_caller_address(fv.contract_address, seller());
    fv.create_vault(CID, PRICE, ih, commitment, short_ttl);
    stop_cheat_caller_address(fv.contract_address);

    let now = starknet::get_block_timestamp();
    start_cheat_block_timestamp(fv.contract_address, now + short_ttl + 1);

    start_cheat_caller_address(fv.contract_address, buyer());
    fv.refund_vault(CID);
    stop_cheat_caller_address(fv.contract_address);
    stop_cheat_block_timestamp(fv.contract_address);
}

#[test]
fn test_get_status_and_price() {
    let (fv, _kex, _token) = setup();
    let commitment = compute_commitment(CID, CLAIM_SECRET);
    let ih: felt252 = 'hash123';

    start_cheat_caller_address(fv.contract_address, seller());
    fv.create_vault(CID, PRICE, ih, commitment, TTL);
    stop_cheat_caller_address(fv.contract_address);

    let status = fv.get_status(CID);
    assert(status == 0, 'should be active');
    let price = fv.get_price(CID);
    assert(price == PRICE, 'price mismatch');
}

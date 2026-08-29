// contracts/src/tests.cairo
// FileVault v2 — snforge 0.61 dual-contract tests

use starknet::ContractAddress;
use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address,
    stop_cheat_caller_address, start_cheat_block_timestamp, stop_cheat_block_timestamp,
};
use crate::filevault::FileVault::{IFileVaultDispatcher, IFileVaultDispatcherTrait, Vault};
use crate::filevault::FileVault::LockState as FileVaultLockState;
use crate::vault_manager::VaultManager::{IVaultManagerDispatcher, IVaultManagerDispatcherTrait};

fn zero_addr() -> ContractAddress {
    0.try_into().unwrap()
}

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
    // pqc and platform_fee_bps (new constructor params)
    let pqc: felt252 = 0;
    pqc.serialize(ref calldata);
    let fee_bps: u16 = 100;
    fee_bps.serialize(ref calldata);
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
    fv.create_vault(CID, PRICE, integrity_hash, commitment, TTL, 1, zero_addr(), 0);
    stop_cheat_caller_address(fv.contract_address);

    let (vault, lock) = fv.get_vault(CID);
    assert(vault.seller == seller(), 'wrong seller');
    assert(vault.price == PRICE, 'wrong price');
    assert(vault.status == 0, 'should be active');
    assert(vault.ttl == TTL, 'wrong ttl');
    assert(vault.pqc == 1, 'pqc should be true');
    assert(vault.platform_fee_bps == 100, 'fee bps should be 100');
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
    fv.create_vault(CID, PRICE, ih, commitment, TTL, 0, zero_addr(), 0);
    // second should panic
    fv.create_vault(CID, PRICE, ih, commitment, TTL, 0, zero_addr(), 0);
    stop_cheat_caller_address(fv.contract_address);
}

#[test]
#[should_panic(expected: 'INVALID_PRICE')]
fn test_create_vault_zero_price() {
    let (fv, _kex, _token) = setup();
    let commitment = compute_commitment(CID, CLAIM_SECRET);
    let ih: felt252 = 'hash123';
    start_cheat_caller_address(fv.contract_address, seller());
    fv.create_vault(CID, 0, ih, commitment, TTL, 0, zero_addr(), 0);
    stop_cheat_caller_address(fv.contract_address);
}

#[test]
#[should_panic(expected: 'INVALID_TTL')]
fn test_create_vault_zero_ttl() {
    let (fv, _kex, _token) = setup();
    let commitment = compute_commitment(CID, CLAIM_SECRET);
    let ih: felt252 = 'hash123';
    start_cheat_caller_address(fv.contract_address, seller());
    fv.create_vault(CID, PRICE, ih, commitment, 0, 0, zero_addr(), 0);
    stop_cheat_caller_address(fv.contract_address);
}

#[test]
fn test_claim_success() {
    let (fv, _kex, _token) = setup();
    let commitment = compute_commitment(CID, CLAIM_SECRET);
    let ih: felt252 = 'hash123';

    start_cheat_caller_address(fv.contract_address, seller());
    fv.create_vault(CID, PRICE, ih, commitment, TTL, 0, zero_addr(), 0);
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
    fv.create_vault(CID, PRICE, ih, commitment, TTL, 0, zero_addr(), 0);
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
    fv.create_vault(CID, PRICE, ih, commitment, TTL, 0, zero_addr(), 0);
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
    fv.create_vault(CID2, PRICE, ih, commitment, TTL, 1, zero_addr(), 0);
    stop_cheat_caller_address(fv.contract_address);

    let (vault, lock) = fv.get_vault(CID2);
    assert(vault.seller == seller(), 'seller mismatch');
    assert(vault.price == PRICE, 'price mismatch');
    assert(vault.status == 0, 'status mismatch');
    assert(vault.pqc == 1, 'pqc true');
    assert(vault.platform_fee_bps == 100, 'bps');
    assert(lock.commitment == commitment, 'commitment mismatch');
    assert(lock.integrity_hash == ih, 'ih mismatch');
    assert(!lock.is_claimed, 'not claimed');
}

#[test]
fn test_pqc_flag_false_and_fee_bps() {
    let (fv, _kex, _token) = setup();
    let commitment = compute_commitment(CID, CLAIM_SECRET);
    let ih: felt252 = 'hash_pqc_false';
    start_cheat_caller_address(fv.contract_address, seller());
    fv.create_vault(CID, PRICE, ih, commitment, TTL, 0, zero_addr(), 0);
    stop_cheat_caller_address(fv.contract_address);
    let (vault, _lock) = fv.get_vault(CID);
    assert(vault.pqc == 0, 'pqc should be false');
    assert(vault.platform_fee_bps == 100, 'fee bps 100');
}

#[test]
fn test_pqc_flag_immutable_after_create() {
    // PQC is set at creation and cannot be modified (no setter exists)
    // Verify both true and false persist correctly via get_vault
    let (fv, _kex, _token) = setup();
    let c1 = compute_commitment(CID, CLAIM_SECRET);
    let c2 = compute_commitment(CID2, CLAIM_SECRET);
    let ih: felt252 = 'hash123';
    start_cheat_caller_address(fv.contract_address, seller());
    fv.create_vault(CID, PRICE, ih, c1, TTL, 1, zero_addr(), 0);
    fv.create_vault(CID2, PRICE, ih, c2, TTL, 0, zero_addr(), 0);
    stop_cheat_caller_address(fv.contract_address);
    let (v1, _) = fv.get_vault(CID);
    let (v2, _) = fv.get_vault(CID2);
    assert(v1.pqc == 1, 'v1 pqc true');
    assert(v2.pqc == 0, 'v2 pqc false');
    assert(v1.platform_fee_bps == 100, 'v1 bps');
    assert(v2.platform_fee_bps == 100, 'v2 bps');
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
    fv.create_vault(CID, PRICE, ih, commitment, TTL, 0, zero_addr(), 0);
    stop_cheat_caller_address(fv.contract_address);

    let fee_after = fv.get_total_fees();
    assert(fee_after == FEE, 'should be FEE after one vault');

    // second vault with different CID should add again
    let commitment2 = compute_commitment(CID2, CLAIM_SECRET);
    start_cheat_caller_address(fv.contract_address, seller());
    fv.create_vault(CID2, PRICE, ih, commitment2, TTL, 0, zero_addr(), 0);
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
    fv.create_vault(CID, PRICE, ih, commitment, short_ttl, 0, zero_addr(), 0);
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
    fv.create_vault(CID, PRICE, ih, commitment, TTL, 0, zero_addr(), 0);
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
    fv.create_vault(CID, PRICE, ih, commitment, short_ttl, 0, zero_addr(), 0);
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
    fv.create_vault(CID, PRICE, ih, commitment, TTL, 0, zero_addr(), 0);
    stop_cheat_caller_address(fv.contract_address);

    let status = fv.get_status(CID);
    assert(status == 0, 'should be active');
    let price = fv.get_price(CID);
    assert(price == PRICE, 'price mismatch');
}

// ---- VaultManager Tests ----

fn pool_addr() -> ContractAddress {
    0xABC.try_into().unwrap()
}

fn owner_addr() -> ContractAddress {
    0xDEF.try_into().unwrap()
}

fn deploy_vault_manager() -> ContractAddress {
    let vm_class = declare("VaultManager").unwrap().contract_class();
    let mut calldata = array![];
    pool_addr().serialize(ref calldata);
    owner_addr().serialize(ref calldata);
    let (vm_address, _) = vm_class.deploy(@calldata).unwrap();
    vm_address
}

fn vm_dispatch(address: ContractAddress) -> IVaultManagerDispatcher {
    IVaultManagerDispatcher { contract_address: address }
}

const VAULT_ID: felt252 = 1;
const TOKEN_ADDR: felt252 = 0x999;
const DURATION: u64 = 0;

#[test]
fn test_vm_constructor() {
    let vm_addr = deploy_vault_manager();
    let vm = vm_dispatch(vm_addr);
    assert(vm.get_pool() == pool_addr(), 'wrong pool');
    assert(vm.get_owner() == owner_addr(), 'wrong owner');
    assert(vm.get_vault_count() == 0, 'count should be 0');
}

#[test]
fn test_vm_set_vault() {
    let vm_addr = deploy_vault_manager();
    let vm = vm_dispatch(vm_addr);
    let fv_addr: ContractAddress = 0x111.try_into().unwrap();
    let token_addr: ContractAddress = TOKEN_ADDR.try_into().unwrap();

    start_cheat_caller_address(vm_addr, owner_addr());
    vm.set_vault(VAULT_ID, fv_addr, token_addr, PRICE, DURATION);
    stop_cheat_caller_address(vm_addr);

    // get_vault succeeds (struct is returned)
    let _config = vm.get_vault(VAULT_ID);
    assert(vm.get_vault_count() == 1, 'count should be 1');
    assert(!vm.has_access(VAULT_ID, buyer()), 'should not have access yet');
}

#[test]
#[should_panic(expected: 'NOT_OWNER')]
fn test_vm_set_vault_not_owner() {
    let vm_addr = deploy_vault_manager();
    let vm = vm_dispatch(vm_addr);
    let fv_addr: ContractAddress = 0x111.try_into().unwrap();
    let token_addr: ContractAddress = TOKEN_ADDR.try_into().unwrap();

    start_cheat_caller_address(vm_addr, buyer());
    vm.set_vault(VAULT_ID, fv_addr, token_addr, PRICE, DURATION);
    stop_cheat_caller_address(vm_addr);
}

#[test]
#[should_panic(expected: 'VAULT_EXISTS')]
fn test_vm_set_vault_duplicate() {
    let vm_addr = deploy_vault_manager();
    let vm = vm_dispatch(vm_addr);
    let fv_addr: ContractAddress = 0x111.try_into().unwrap();
    let token_addr: ContractAddress = TOKEN_ADDR.try_into().unwrap();

    start_cheat_caller_address(vm_addr, owner_addr());
    vm.set_vault(VAULT_ID, fv_addr, token_addr, PRICE, DURATION);
    vm.set_vault(VAULT_ID, fv_addr, token_addr, PRICE, DURATION);
    stop_cheat_caller_address(vm_addr);
}

#[test]
fn test_vm_mint_access() {
    let vm_addr = deploy_vault_manager();
    let vm = vm_dispatch(vm_addr);
    let fv_addr: ContractAddress = 0x111.try_into().unwrap();
    let token_addr: ContractAddress = TOKEN_ADDR.try_into().unwrap();

    // Setup vault
    start_cheat_caller_address(vm_addr, owner_addr());
    vm.set_vault(VAULT_ID, fv_addr, token_addr, PRICE, DURATION);
    stop_cheat_caller_address(vm_addr);

    // Pool calls mint_access
    start_cheat_caller_address(vm_addr, pool_addr());
    vm.mint_access(VAULT_ID, buyer());
    stop_cheat_caller_address(vm_addr);

    assert(vm.has_access(VAULT_ID, buyer()), 'should have access');
}

#[test]
#[should_panic(expected: 'ONLY_POOL')]
fn test_vm_mint_access_not_pool() {
    let vm_addr = deploy_vault_manager();
    let vm = vm_dispatch(vm_addr);
    let fv_addr: ContractAddress = 0x111.try_into().unwrap();
    let token_addr: ContractAddress = TOKEN_ADDR.try_into().unwrap();

    start_cheat_caller_address(vm_addr, owner_addr());
    vm.set_vault(VAULT_ID, fv_addr, token_addr, PRICE, DURATION);
    stop_cheat_caller_address(vm_addr);

    // Non-pool caller
    start_cheat_caller_address(vm_addr, buyer());
    vm.mint_access(VAULT_ID, buyer());
    stop_cheat_caller_address(vm_addr);
}

#[test]
#[should_panic(expected: 'VAULT_NOT_FOUND')]
fn test_vm_mint_access_vault_not_found() {
    let vm_addr = deploy_vault_manager();
    let vm = vm_dispatch(vm_addr);

    start_cheat_caller_address(vm_addr, pool_addr());
    vm.mint_access(999, buyer());
    stop_cheat_caller_address(vm_addr);
}

#[test]
fn test_vm_mint_access_idempotent() {
    let vm_addr = deploy_vault_manager();
    let vm = vm_dispatch(vm_addr);
    let fv_addr: ContractAddress = 0x111.try_into().unwrap();
    let token_addr: ContractAddress = TOKEN_ADDR.try_into().unwrap();

    start_cheat_caller_address(vm_addr, owner_addr());
    vm.set_vault(VAULT_ID, fv_addr, token_addr, PRICE, DURATION);
    stop_cheat_caller_address(vm_addr);

    start_cheat_caller_address(vm_addr, pool_addr());
    vm.mint_access(VAULT_ID, buyer());
    // Second call should not panic (idempotent)
    vm.mint_access(VAULT_ID, buyer());
    stop_cheat_caller_address(vm_addr);

    assert(vm.has_access(VAULT_ID, buyer()), 'should have access');
}

#[test]
fn test_vm_has_access_false() {
    let vm_addr = deploy_vault_manager();
    let vm = vm_dispatch(vm_addr);

    assert(!vm.has_access(VAULT_ID, buyer()), 'should not have access');
}

#[test]
fn test_vm_set_pool() {
    let vm_addr = deploy_vault_manager();
    let vm = vm_dispatch(vm_addr);
    let new_pool: ContractAddress = 0xEEE.try_into().unwrap();

    start_cheat_caller_address(vm_addr, owner_addr());
    vm.set_pool(new_pool);
    stop_cheat_caller_address(vm_addr);

    assert(vm.get_pool() == new_pool, 'pool should be updated');
}

#[test]
#[should_panic(expected: 'NOT_OWNER')]
fn test_vm_set_pool_not_owner() {
    let vm_addr = deploy_vault_manager();
    let vm = vm_dispatch(vm_addr);
    let new_pool: ContractAddress = 0xEEE.try_into().unwrap();

    start_cheat_caller_address(vm_addr, buyer());
    vm.set_pool(new_pool);
    stop_cheat_caller_address(vm_addr);
}

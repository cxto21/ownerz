// contracts/src/tests_access.cairo
// Tests for optional access catalog: AccessToken (ERC20 soulbound) + AccessFactory + FileVault access_token

use starknet::ContractAddress;
use starknet::ClassHash;
use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address,
    stop_cheat_caller_address, start_cheat_block_timestamp, stop_cheat_block_timestamp,
};
use crate::access_token::AccessToken::{IAccessTokenDispatcher, IAccessTokenDispatcherTrait};
use crate::access_factory::AccessFactory::{IAccessFactoryDispatcher, IAccessFactoryDispatcherTrait};
use crate::filevault::FileVault::{IFileVaultDispatcher, IFileVaultDispatcherTrait};

// Reuse MockERC20 and KeyExchangeMockup from tests module? Duplicate minimal helpers here.
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
mod MockERC20Access {
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

use crate::filevault::FileVault::LockState as FileVaultLockState;

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
mod KeyExchangeMockupAccess {
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

// Helpers

fn seller() -> ContractAddress { 0x123.try_into().unwrap() }
fn buyer() -> ContractAddress { 0x456.try_into().unwrap() }
fn other() -> ContractAddress { 0x789.try_into().unwrap() }
fn platform_wallet() -> ContractAddress { 0x999.try_into().unwrap() }
fn zero_addr() -> ContractAddress { 0.try_into().unwrap() }

fn compute_commitment(cid: felt252, claim_secret: u16) -> felt252 {
    let high: felt252 = ((claim_secret / 256) & 0xFF).into();
    let low: felt252 = (claim_secret & 0xFF).into();
    core::pedersen::pedersen(core::pedersen::pedersen(cid, high), low)
}

fn deploy_kex() -> ContractAddress {
    let cls = declare("KeyExchangeMockupAccess").unwrap().contract_class();
    let (addr, _) = cls.deploy(@array![]).unwrap();
    addr
}
fn deploy_mock_erc20() -> ContractAddress {
    let cls = declare("MockERC20Access").unwrap().contract_class();
    let (addr, _) = cls.deploy(@array![]).unwrap();
    addr
}
fn deploy_filevault(kex: ContractAddress, mock: ContractAddress) -> ContractAddress {
    let cls = declare("FileVault").unwrap().contract_class();
    let mut calldata = array![];
    platform_wallet().serialize(ref calldata);
    let fee: u256 = 500000000000000000;
    fee.serialize(ref calldata);
    mock.serialize(ref calldata);
    kex.serialize(ref calldata);
    false.serialize(ref calldata);
    let bps: u16 = 100;
    bps.serialize(ref calldata);
    let (addr, _) = cls.deploy(@calldata).unwrap();
    addr
}
fn deploy_access_token(
    name: ByteArray, symbol: ByteArray, price: u256, duration: u64, owner: ContractAddress,
) -> ContractAddress {
    let cls = declare("AccessToken").unwrap().contract_class();
    let mut calldata = array![];
    name.serialize(ref calldata);
    symbol.serialize(ref calldata);
    price.serialize(ref calldata);
    duration.serialize(ref calldata);
    owner.serialize(ref calldata);
    let (addr, _) = cls.deploy(@calldata).unwrap();
    addr
}
fn deploy_factory(class_hash: ClassHash) -> ContractAddress {
    let cls = declare("AccessFactory").unwrap().contract_class();
    let mut calldata = array![];
    class_hash.serialize(ref calldata);
    let (addr, _) = cls.deploy(@calldata).unwrap();
    addr
}

// ─── AccessToken tests ───────────────────────────────────────

#[test]
fn test_access_token_mint_free_forever() {
    let price: u256 = 0;
    let duration: u64 = 0; // forever
    let token = deploy_access_token("FreePass", "FREE", price, duration, seller());
    let disp = IAccessTokenDispatcher { contract_address: token };

    assert(disp.get_price() == 0, 'price 0');
    assert(disp.get_duration() == 0, 'dur 0');
    assert(disp.balance_of(buyer()) == 0, 'bal 0 before');

    start_cheat_caller_address(token, buyer());
    disp.mint();
    stop_cheat_caller_address(token);

    assert(disp.balance_of(buyer()) == 1, 'bal 1 after mint');
    assert(disp.has_access(buyer()) == true, 'has access forever');
    assert(disp.is_expired(buyer()) == false, 'not expired forever');
    assert(disp.get_expiry(buyer()) == 0, 'expiry 0 for forever');
    assert(disp.total_supply() == 1, 'supply 1');
}

#[test]
fn test_access_token_mint_with_duration_and_has_access() {
    let price: u256 = 1000000000000000000; // 1 STRK
    let duration: u64 = 1000;
    let token = deploy_access_token("Monthly", "MON", price, duration, seller());
    let disp = IAccessTokenDispatcher { contract_address: token };

    start_cheat_caller_address(token, buyer());
    disp.mint();
    stop_cheat_caller_address(token);

    assert(disp.balance_of(buyer()) == 1, 'bal 1');
    assert(disp.has_access(buyer()) == true, 'has access');
    assert(disp.is_expired(buyer()) == false, 'not expired');

    let exp = disp.get_expiry(buyer());
    assert(exp != 0, 'expiry not 0');

    // warp past expiry
    start_cheat_block_timestamp(token, exp + 1);
    assert(disp.is_expired(buyer()) == true, 'expired after');
    assert(disp.has_access(buyer()) == false, 'no access after expiry');
    stop_cheat_block_timestamp(token);

    // renew by minting again (same holder)
    start_cheat_caller_address(token, buyer());
    disp.mint();
    stop_cheat_caller_address(token);
    assert(disp.has_access(buyer()) == true, 'renewed has access');
    assert(disp.balance_of(buyer()) == 1, 'still 1 (soulbound non-dupe)');
}

#[test]
#[should_panic(expected: 'SOULBOUND')]
fn test_access_token_soulbound_transfer_blocked() {
    let token = deploy_access_token("Soul", "SOUL", 0, 0, seller());
    let disp = IAccessTokenDispatcher { contract_address: token };
    start_cheat_caller_address(token, buyer());
    disp.mint();
    stop_cheat_caller_address(token);
    // try to transfer — must panic SOULBOUND
    start_cheat_caller_address(token, buyer());
    disp.transfer(other(), 1);
    stop_cheat_caller_address(token);
}

#[test]
#[should_panic(expected: 'SOULBOUND')]
fn test_access_token_soulbound_transfer_from_blocked() {
    let token = deploy_access_token("Soul2", "S2", 0, 0, seller());
    let disp = IAccessTokenDispatcher { contract_address: token };
    start_cheat_caller_address(token, buyer());
    disp.mint();
    stop_cheat_caller_address(token);
    start_cheat_caller_address(token, buyer());
    disp.transfer_from(buyer(), other(), 1);
    stop_cheat_caller_address(token);
}

#[test]
fn test_access_token_mint_to_airdrop() {
    let token = deploy_access_token("Airdrop", "AIR", 0, 0, seller());
    let disp = IAccessTokenDispatcher { contract_address: token };
    // seller airdrops to buyer
    start_cheat_caller_address(token, seller());
    disp.mint_to(buyer());
    stop_cheat_caller_address(token);
    assert(disp.balance_of(buyer()) == 1, 'airdrop bal 1');
    assert(disp.has_access(buyer()) == true, 'has access');
    // buyer cannot mint_to other (NOT_OWNER)
    // covered in next test
}

#[test]
#[should_panic(expected: 'NOT_OWNER')]
fn test_access_token_mint_to_not_owner_fails() {
    let token = deploy_access_token("Airdrop2", "A2", 0, 0, seller());
    let disp = IAccessTokenDispatcher { contract_address: token };
    start_cheat_caller_address(token, buyer());
    disp.mint_to(other());
    stop_cheat_caller_address(token);
}

#[test]
fn test_access_token_erc20_metadata() {
    let token = deploy_access_token("My Catalog", "CAT", 0, 0, seller());
    let disp = IAccessTokenDispatcher { contract_address: token };
    let n = disp.name();
    let s = disp.symbol();
    // ByteArray equality: check via string comparison using == with ByteArray literal? Use length check.
    // simplest: name not empty, decimals 18
    assert(disp.decimals() == 18, 'dec 18');
    assert(disp.total_supply() == 0, 'supply 0 init');
    // ensure name/symbol were stored (non-empty)
    // ByteArray stored correctly (non-empty check via equality not needing len)
    assert(n != "", 'name non empty');
    assert(s != "", 'symbol non empty');
}

#[test]
fn test_access_token_approve_still_works_but_transfer_blocked() {
    let token = deploy_access_token("Approve", "AP", 0, 0, seller());
    let disp = IAccessTokenDispatcher { contract_address: token };
    start_cheat_caller_address(token, buyer());
    let ok = disp.approve(other(), 100);
    stop_cheat_caller_address(token);
    assert(ok == true, 'approve ok');
    assert(disp.allowance(buyer(), other()) == 100, 'allowance set');
}

// ─── Factory tests ───────────────────────────────────────────

#[test]
fn test_factory_create_token() {
    let cls_res = declare("AccessToken").unwrap();
    let cls_hash: ClassHash = *cls_res.contract_class().class_hash;
    let factory = deploy_factory(0.try_into().unwrap());
    let f_disp = IAccessFactoryDispatcher { contract_address: factory };
    // set class hash
    start_cheat_caller_address(factory, seller());
    f_disp.set_class_hash(cls_hash);
    stop_cheat_caller_address(factory);
    assert(f_disp.get_class_hash() == cls_hash, 'class hash set');

    // seller creates token via factory
    start_cheat_caller_address(factory, seller());
    let token_addr = f_disp.create_token("FactoryTok", "FTK", 0, 0);
    stop_cheat_caller_address(factory);

    assert(token_addr != zero_addr(), 'token deployed');
    assert(f_disp.get_token_count() == 1, 'count 1');
    assert(f_disp.get_token(0) == token_addr, 'token 0');
    assert(f_disp.get_seller_token_count(seller()) == 1, 'seller count 1');
    assert(f_disp.get_seller_token(seller(), 0) == token_addr, 'seller token');

    // Verify token ownership
    let tok = IAccessTokenDispatcher { contract_address: token_addr };
    assert(tok.get_owner() == seller(), 'owner is seller');
    assert(tok.get_price() == 0, 'price 0');
}

#[test]
fn test_factory_multiple_tokens_per_seller() {
    let cls_res2 = declare("AccessToken").unwrap();
    let cls_hash2: ClassHash = *cls_res2.contract_class().class_hash;
    let factory = deploy_factory(cls_hash2);
    let f_disp = IAccessFactoryDispatcher { contract_address: factory };

    start_cheat_caller_address(factory, seller());
    let t1 = f_disp.create_token("Tok1", "TK1", 0, 0);
    let t2 = f_disp.create_token("Tok2", "TK2", 100, 500);
    stop_cheat_caller_address(factory);

    assert(f_disp.get_token_count() == 2, 'count 2');
    assert(f_disp.get_seller_token_count(seller()) == 2, 'seller 2');
    assert(t1 != t2, 'different addresses');

    let d1 = IAccessTokenDispatcher { contract_address: t1 };
    let d2 = IAccessTokenDispatcher { contract_address: t2 };
    assert(d1.get_duration() == 0, 't1 forever');
    assert(d2.get_duration() == 500, 't2 500');
}

// ─── FileVault access_token tests ────────────────────────────

#[test]
fn test_filevault_public_vault_access_token_zero() {
    let kex = deploy_kex();
    let mock = deploy_mock_erc20();
    let fv_addr = deploy_filevault(kex, mock);
    let fv = IFileVaultDispatcher { contract_address: fv_addr };

    let cid: felt252 = 'cid_public';
    let commitment = compute_commitment(cid, 0x1234);
    start_cheat_caller_address(fv_addr, seller());
    fv.create_vault(cid, 1000000000000000000, 'hash', commitment, 2592000, false, zero_addr());
    stop_cheat_caller_address(fv_addr);

    let (vault, _) = fv.get_vault(cid);
    assert(vault.access_token == zero_addr(), 'public vault 0');
    assert(fv.get_access_token(cid) == zero_addr(), 'getter 0');
}

#[test]
fn test_filevault_gated_vault_stores_token() {
    let kex = deploy_kex();
    let mock = deploy_mock_erc20();
    let fv_addr = deploy_filevault(kex, mock);
    let fv = IFileVaultDispatcher { contract_address: fv_addr };

    let token = deploy_access_token("Gated", "GATE", 0, 0, seller());
    let cid: felt252 = 'cid_gated';
    let commitment = compute_commitment(cid, 0x1234);
    start_cheat_caller_address(fv_addr, seller());
    fv.create_vault(cid, 1000000000000000000, 'hash', commitment, 2592000, false, token);
    stop_cheat_caller_address(fv_addr);

    let (vault, _) = fv.get_vault(cid);
    assert(vault.access_token == token, 'gated token stored');
    assert(fv.get_access_token(cid) == token, 'getter token');

    // gated vs public logic: public always visible, gated requires has_access
    let gated_disp = IAccessTokenDispatcher { contract_address: token };
    // seller has not minted to buyer yet => buyer has no access
    assert(gated_disp.has_access(buyer()) == false, 'buyer no access');
    // after mint, buyer gets access
    start_cheat_caller_address(token, buyer());
    gated_disp.mint();
    stop_cheat_caller_address(token);
    assert(gated_disp.has_access(buyer()) == true, 'buyer now has access');
}

#[test]
fn test_filevault_has_access_filter_logic_public_always_visible() {
    // Simulates BuyFlow filter: visible = public || hasAccess
    let token = deploy_access_token("Filter", "FIL", 0, 1000, seller());
    let disp = IAccessTokenDispatcher { contract_address: token };
    let public_token = zero_addr();

    // helper to compute visibility
    let visible_public = if public_token == zero_addr() { true } else { disp.has_access(buyer()) };
    assert(visible_public == true, 'public visible');

    let visible_gated_before = disp.has_access(buyer());
    assert(visible_gated_before == false, 'gated not visible before mint');

    start_cheat_caller_address(token, buyer());
    disp.mint();
    stop_cheat_caller_address(token);
    let visible_gated_after = disp.has_access(buyer());
    assert(visible_gated_after == true, 'gated visible after mint');

    // expire
    let exp = disp.get_expiry(buyer());
    start_cheat_block_timestamp(token, exp + 1);
    let visible_expired = disp.has_access(buyer());
    assert(visible_expired == false, 'expired not visible');
    stop_cheat_block_timestamp(token);
}

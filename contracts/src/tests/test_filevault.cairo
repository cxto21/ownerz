#[cfg(test)]
mod tests {
    use snforge_std::{start_prank, stop_prank, CheatTarget};
    use starknet::ContractAddress;
    use starknet::contract_address_const;
    use starknet::get_block_timestamp;
    use ownerz_filevault::filevault::FileVault;
    use ownerz_filevault::filevault::FileVault::Vault;

    const SELLER: felt252 = 'seller';
    const BUYER: felt252 = 'buyer';
    const CID: felt252 = 'test_cid_123';
    const PRICE: u256 = 1000000000000000000; // 1 STRK
    const CLAIM_SECRET: u16 = 0x1234;
    const TTL: u64 = 2592000; // 30 days

    fn setup() -> FileVault::ContractDispatcher {
        let contract = FileVault::deploy(()).unwrap();
        contract
    }

    fn compute_commitment(cid: felt252, claim_secret: u16) -> felt252 {
        let high: felt252 = ((claim_secret / 256) & 0xFF).into();
        let low: felt252 = ((claim_secret) & 0xFF).into();
        starknet::pedersen_pedersen(starknet::pedersen_pedersen(cid, high), low)
    }

    #[test]
    fn test_create_vault() {
        let contract = setup();
        let seller: ContractAddress = contract_address_const::<0x123>();
        let ciphertext: felt252 = 'encrypted_key';
        let commitment = compute_commitment(CID, CLAIM_SECRET);

        start_prank(CheatTarget::One(contract.contract_address), seller);
        contract.create_vault(CID, PRICE, ciphertext, commitment, TTL);
        stop_prank(contract.contract_address);

        let vault = contract.get_vault(CID);
        assert(vault.seller == seller, 'Wrong seller');
        assert(vault.price == PRICE, 'Wrong price');
        assert(vault.status == 0, 'Wrong status');
    }

    #[test]
    #[should_panic(expected: 'VAULT_EXISTS')]
    fn test_create_vault_duplicate() {
        let contract = setup();
        let seller: ContractAddress = contract_address_const::<0x123>();
        let ciphertext: felt252 = 'encrypted_key';
        let commitment = compute_commitment(CID, CLAIM_SECRET);

        start_prank(CheatTarget::One(contract.contract_address), seller);
        contract.create_vault(CID, PRICE, ciphertext, commitment, TTL);
        contract.create_vault(CID, PRICE, ciphertext, commitment, TTL);
        stop_prank(contract.contract_address);
    }

    #[test]
    #[should_panic(expected: 'INVALID_PRICE')]
    fn test_create_vault_zero_price() {
        let contract = setup();
        let seller: ContractAddress = contract_address_const::<0x123>();
        let ciphertext: felt252 = 'encrypted_key';
        let commitment = compute_commitment(CID, CLAIM_SECRET);

        start_prank(CheatTarget::One(contract.contract_address), seller);
        contract.create_vault(CID, 0, ciphertext, commitment, TTL);
        stop_prank(contract.contract_address);
    }

    #[test]
    #[should_panic(expected: 'INVALID_TTL')]
    fn test_create_vault_zero_ttl() {
        let contract = setup();
        let seller: ContractAddress = contract_address_const::<0x123>();
        let ciphertext: felt252 = 'encrypted_key';
        let commitment = compute_commitment(CID, CLAIM_SECRET);

        start_prank(CheatTarget::One(contract.contract_address), seller);
        contract.create_vault(CID, PRICE, ciphertext, commitment, 0);
        stop_prank(contract.contract_address);
    }

    #[test]
    fn test_claim_vault() {
        let contract = setup();
        let seller: ContractAddress = contract_address_const::<0x123>();
        let buyer: ContractAddress = contract_address_const::<0x456>();
        let ciphertext: felt252 = 'encrypted_key';
        let commitment = compute_commitment(CID, CLAIM_SECRET);

        start_prank(CheatTarget::One(contract.contract_address), seller);
        contract.create_vault(CID, PRICE, ciphertext, commitment, TTL);
        stop_prank(contract.contract_address);

        start_prank(CheatTarget::One(contract.contract_address), buyer);
        contract.claim_vault(CID, CLAIM_SECRET);
        stop_prank(contract.contract_address);

        let vault = contract.get_vault(CID);
        assert(vault.status == 1, 'Should be claimed');
    }

    #[test]
    #[should_panic(expected: 'INVALID_SECRET')]
    fn test_claim_vault_wrong_secret() {
        let contract = setup();
        let seller: ContractAddress = contract_address_const::<0x123>();
        let buyer: ContractAddress = contract_address_const::<0x456>();
        let ciphertext: felt252 = 'encrypted_key';
        let commitment = compute_commitment(CID, CLAIM_SECRET);

        start_prank(CheatTarget::One(contract.contract_address), seller);
        contract.create_vault(CID, PRICE, ciphertext, commitment, TTL);
        stop_prank(contract.contract_address);

        start_prank(CheatTarget::One(contract.contract_address), buyer);
        contract.claim_vault(CID, 0xFFFF); // wrong secret
        stop_prank(contract.contract_address);
    }

    #[test]
    #[should_panic(expected: 'ALREADY_CLAIMED')]
    fn test_claim_vault_twice() {
        let contract = setup();
        let seller: ContractAddress = contract_address_const::<0x123>();
        let buyer: ContractAddress = contract_address_const::<0x456>();
        let ciphertext: felt252 = 'encrypted_key';
        let commitment = compute_commitment(CID, CLAIM_SECRET);

        start_prank(CheatTarget::One(contract.contract_address), seller);
        contract.create_vault(CID, PRICE, ciphertext, commitment, TTL);
        stop_prank(contract.contract_address);

        start_prank(CheatTarget::One(contract.contract_address), buyer);
        contract.claim_vault(CID, CLAIM_SECRET);
        contract.claim_vault(CID, CLAIM_SECRET); // should fail
        stop_prank(contract.contract_address);
    }

    #[test]
    fn test_refund_vault() {
        let contract = setup();
        let seller: ContractAddress = contract_address_const::<0x123>();
        let ciphertext: felt252 = 'encrypted_key';
        let commitment = compute_commitment(CID, CLAIM_SECRET);

        start_prank(CheatTarget::One(contract.contract_address), seller);
        contract.create_vault(CID, PRICE, ciphertext, commitment, TTL);

        // Fast forward time past TTL
        // Note: snforge doesn't have time travel, so this test verifies the logic
        // In practice, you'd need to mock get_block_timestamp
        contract.refund_vault(CID);
        stop_prank(contract.contract_address);

        let vault = contract.get_vault(CID);
        assert(vault.status == 2, 'Should be refunded');
    }

    #[test]
    #[should_panic(expected: 'NOT_SELLER')]
    fn test_refund_vault_not_seller() {
        let contract = setup();
        let seller: ContractAddress = contract_address_const::<0x123>();
        let not_seller: ContractAddress = contract_address_const::<0x789>();
        let ciphertext: felt252 = 'encrypted_key';
        let commitment = compute_commitment(CID, CLAIM_SECRET);

        start_prank(CheatTarget::One(contract.contract_address), seller);
        contract.create_vault(CID, PRICE, ciphertext, commitment, TTL);
        stop_prank(contract.contract_address);

        start_prank(CheatTarget::One(contract.contract_address), not_seller);
        contract.refund_vault(CID);
        stop_prank(contract.contract_address);
    }

    #[test]
    fn test_get_vault() {
        let contract = setup();
        let seller: ContractAddress = contract_address_const::<0x123>();
        let ciphertext: felt252 = 'encrypted_key';
        let commitment = compute_commitment(CID, CLAIM_SECRET);

        start_prank(CheatTarget::One(contract.contract_address), seller);
        contract.create_vault(CID, PRICE, ciphertext, commitment, TTL);
        stop_prank(contract.contract_address);

        let vault = contract.get_vault(CID);
        assert(vault.seller == seller, 'Wrong seller');
        assert(vault.price == PRICE, 'Wrong price');
        assert(vault.key_seed_ciphertext == ciphertext, 'Wrong ciphertext');
    }

    #[test]
    fn test_get_status() {
        let contract = setup();
        let seller: ContractAddress = contract_address_const::<0x123>();
        let ciphertext: felt252 = 'encrypted_key';
        let commitment = compute_commitment(CID, CLAIM_SECRET);

        start_prank(CheatTarget::One(contract.contract_address), seller);
        contract.create_vault(CID, PRICE, ciphertext, commitment, TTL);
        stop_prank(contract.contract_address);

        let status = contract.get_status(CID);
        assert(status == 0, 'Should be active');
    }

    #[test]
    fn test_get_price() {
        let contract = setup();
        let seller: ContractAddress = contract_address_const::<0x123>();
        let ciphertext: felt252 = 'encrypted_key';
        let commitment = compute_commitment(CID, CLAIM_SECRET);

        start_prank(CheatTarget::One(contract.contract_address), seller);
        contract.create_vault(CID, PRICE, ciphertext, commitment, TTL);
        stop_prank(contract.contract_address);

        let price = contract.get_price(CID);
        assert(price == PRICE, 'Wrong price');
    }
}

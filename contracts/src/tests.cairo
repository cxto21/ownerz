#[cfg(test)]
mod tests {
    use starknet::ContractAddress;
    use starknet::contract_address_const;
    use starknet::testing::set_caller_address;
    use starknet::testing::set_block_timestamp;
    use ownerz_filevault::filevault::FileVault;
    use ownerz_filevault::filevault::FileVault::Vault;

    const CID: felt252 = 'test_cid_123';
    const PRICE: u256 = 1000000000000000000;
    const CLAIM_SECRET: u16 = 0x1234;
    const TTL: u64 = 2592000;

    fn compute_commitment(cid: felt252, claim_secret: u16) -> felt252 {
        let high: felt252 = ((claim_secret / 256) & 0xFF).into();
        let low: felt252 = ((claim_secret) & 0xFF).into();
        starknet::pedersen_pedersen(starknet::pedersen_pedersen(cid, high), low)
    }

    #[test]
    fn test_create_vault() {
        let contract = FileVault::deploy(()).unwrap();
        let seller: ContractAddress = contract_address_const::<0x123>();
        let ciphertext: felt252 = 'encrypted_key';
        let commitment = compute_commitment(CID, CLAIM_SECRET);

        set_caller_address(seller);
        contract.create_vault(CID, PRICE, ciphertext, commitment, TTL);

        let vault = contract.get_vault(CID);
        assert(vault.seller == seller, 'Wrong seller');
        assert(vault.price == PRICE, 'Wrong price');
        assert(vault.status == 0, 'Wrong status');
    }
}

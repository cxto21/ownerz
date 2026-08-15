// SPDX-License-Identifier: MIT
// Ownerz Fee Collector Contract
// Collects fees for file uploads proportional to file size

#[contract]
mod FeeCollector {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::contract_address::ContractAddressTrait;

    // Storage
    struct Storage {
        owner: ContractAddress,
        total_collected: u256,
        fee_per_byte: u256,
        min_fee: u256,
    }

    // Events
    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        FeePaid: FeePaid,
        Withdraw: Withdraw,
    }

    #[derive(Drop, starknet::Event)]
    struct FeePaid {
        payer: ContractAddress,
        file_size: u256,
        fee: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Withdraw {
        to: ContractAddress,
        amount: u256,
    }

    // Constructor
    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        fee_per_byte: u256,
        min_fee: u256,
    ) {
        self.owner.write(owner);
        self.fee_per_byte.write(fee_per_byte);
        self.min_fee.write(min_fee);
    }

    // External functions
    #[external(v0)]
    fn pay_fee(ref self: ContractState, file_size: u256) {
        let caller = get_caller_address();
        let fee_per_byte = self.fee_per_byte.read();
        let min_fee = self.min_fee.read();

        // Calculate fee
        let mut fee = file_size * fee_per_byte;
        if fee < min_fee {
            fee = min_fee;
        }

        // In production: transfer STRK from caller to this contract
        // For now, just record the payment
        self.total_collected.write(self.total_collected.read() + fee);

        // Emit event
        self.emit(FeePaid {
            payer: caller,
            file_size: file_size,
            fee: fee,
        });
    }

    #[external(v0)]
    fn withdraw(ref self: ContractState, to: ContractAddress, amount: u256) {
        let caller = get_caller_address();
        assert(caller == self.owner.read(), 'Only owner can withdraw');
        
        let total = self.total_collected.read();
        assert(amount <= total, 'Insufficient balance');

        self.total_collected.write(total - amount);

        // In production: transfer STRK to recipient
        self.emit(Withdraw {
            to: to,
            amount: amount,
        });
    }

    // View functions
    #[view]
    fn get_fee(self: @ContractState, file_size: u256) -> u256 {
        let fee_per_byte = self.fee_per_byte.read();
        let min_fee = self.min_fee.read();

        let mut fee = file_size * fee_per_byte;
        if fee < min_fee {
            fee = min_fee;
        }
        fee
    }

    #[view]
    fn get_total_collected(self: @ContractState) -> u256 {
        self.total_collected.read()
    }

    #[view]
    fn get_owner(self: @ContractState) -> ContractAddress {
        self.owner.read()
    }

    #[view]
    fn get_fee_per_byte(self: @ContractState) -> u256 {
        self.fee_per_byte.read()
    }

    #[view]
    fn get_min_fee(self: @ContractState) -> u256 {
        self.min_fee.read()
    }
}

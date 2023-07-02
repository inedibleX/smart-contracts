// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.5.16;

import "../InedibleXV1ERC20.sol";

contract PairERC20 is InedibleXV1ERC20 {
    constructor(uint _totalSupply) public {
        _mint(msg.sender, _totalSupply);
    }
}
// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.17;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract SandwichToken is ERC20 {
    constructor() ERC20("Sandwich Token", "SWT"){
        _mint(0xE164A4197E57E7224d26594fb96F3478fEf02D8e, 1e27);
    }
}
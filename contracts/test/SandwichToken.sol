// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.17;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MoronToken is ERC20 {
    constructor() ERC20("Moron Token", "MOT"){
        // _mint(0xE164A4197E57E7224d26594fb96F3478fEf02D8e, 1e27);
        _mint(0xF5265544F4072692409Bd41267679dd548489d42, 1e22);

    }
}
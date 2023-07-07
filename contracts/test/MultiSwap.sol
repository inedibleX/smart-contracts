// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.8.17;

import "../interfaces/IInedibleXV1Pair.sol";
import {IERC20} from "../interfaces/IERC20.sol";

contract MultiSwap {
    IInedibleXV1Pair public pool;

    constructor(address _pool) {
        pool = IInedibleXV1Pair(_pool);
    }

    function swapNTimes(
        uint times,
        uint[] memory expectedAmounts,
        uint amount,
        address _tokenIn
    ) public {
        require(
            times == expectedAmounts.length,
            "times != expectedAmounts.length"
        );

        for (uint i = 0; i < times; i++) {
            IERC20(_tokenIn).transfer(address(pool), amount);
            pool.swap(expectedAmounts[0], 0, msg.sender, msg.sender, "");
        }
    }
}

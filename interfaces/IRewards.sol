// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.5.0;

interface IRewards {
    function payFee(address _token, uint256 _amount) external;
}

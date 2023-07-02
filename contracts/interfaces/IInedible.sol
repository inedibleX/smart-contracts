// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.5.0;

interface IInedibleToken {
    function acceptAdmin() external;

    function admin() external view returns (address);

    function allowance(
        address owner,
        address spender
    ) external view returns (uint256);

    function approve(address spender, uint256 amount) external returns (bool);

    function balanceOf(address account) external view returns (uint256);

    function clock() external view returns (uint48);

    function decimals() external view returns (uint8);

    function decreaseAllowance(
        address spender,
        uint256 subtractedValue
    ) external returns (bool);

    function delegate(address delegatee) external;

    function delegateBySig(
        address delegatee,
        uint256 nonce,
        uint256 expiry,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    function delegates(address account) external view returns (address);

    function getPastTotalSupply(
        uint256 timepoint
    ) external view returns (uint256);

    function getPastVotes(
        address account,
        uint256 timepoint
    ) external view returns (uint256);

    function getVotes(address account) external view returns (uint256);

    function increaseAllowance(
        address spender,
        uint256 addedValue
    ) external returns (bool);

    function nonces(address owner) external view returns (uint256);

    function numCheckpoints(address account) external view returns (uint32);

    function pendingAdmin() external view returns (address);

    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    function renounceAdmin() external;

    function toggleDex(address _newDex) external;

    function totalSupply() external view returns (uint256);

    function transfer(address to, uint256 amount) external returns (bool);

    function transferAdmin(address _newAdmin) external;

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool);
}

// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.5.16;

import "./interfaces/IInedibleXV1Factory.sol";
import "./InedibleXV1Pair.sol";

contract InedibleXV1Factory is IInedibleXV1Factory {
    address public feeTo;
    address public treasury;

    // Added by Inedible
    address public dao;
    address public pendingDao;
    uint256 public minLaunchFeePct = 100;
    uint256 public minSupplyPct = 5000;
    uint public constant DENOMINATOR = 10000;
    address public constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;

    modifier onlyDao() {
        require(msg.sender == dao, "Inedible: onlyDao");
        _;
    }

    constructor(address _dao, address _feeTo) public {
        dao = _dao;
        feeTo = _feeTo;
    }

    function allPairsLength() external view returns (uint) {
        return allPairs.length;
    }

    function createPair(
        address tokenA,
        address tokenB,
        uint supplyPct,
        uint launchFeePct,
        uint lock,
        uint vesting
    ) external returns (address pair) {
        require(tokenA != tokenB, "UniswapV2: IDENTICAL_ADDRESSES");
        require(
            tokenA == WETH || tokenB == WETH,
            "Inedible: pair must be against WETH"
        );
        require(
            launchFeePct >= minLaunchFeePct,
            "Inedible: Launch fee is not high enough."
        );
        require(supplyPct >= minSupplyPct, "Inedible: invalid supply %");
        require(lock >= 30 days, "Inedible: invalid lock duration");
        require(vesting >= 30 days, "Inedible: invalid vesting duration");
        (address token0, address token1) = tokenA < tokenB
            ? (tokenA, tokenB)
            : (tokenB, tokenA);
        require(token0 != address(0), "UniswapV2: ZERO_ADDRESS");
        require(
            getPair[token0][token1] == address(0),
            "UniswapV2: PAIR_EXISTS"
        ); // single check is sufficient
        bytes memory bytecode = type(InedibleXV1Pair).creationCode;
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        assembly {
            pair := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }
        IInedibleXV1Pair(pair).initialize(
            token0,
            token1,
            supplyPct, // min supply %
            launchFeePct, // launch fee %
            true, // launch
            lock, // lock duration
            vesting, // vesting duration
            msg.sender // deployer
        );
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair; // populate mapping in the reverse direction
        allPairs.push(pair);
        emit PairCreated(
            token0,
            token1,
            pair,
            allPairs.length,
            supplyPct,
            lock,
            vesting
        );
    }

    function setFeeTo(address _feeTo) external onlyDao {
        feeTo = _feeTo;
    }

    // Added by Inedible
    function setLaunchFeePct(uint256 _launchFeePct) external onlyDao {
        require(_launchFeePct <= DENOMINATOR, "Inedible: invalid launch fee");
        minLaunchFeePct = _launchFeePct;
    }

    function setMinSupplyPct(uint256 _minSupplyPct) external onlyDao {
        // min supply % should be > 50%
        require(
            _minSupplyPct <= DENOMINATOR && _minSupplyPct > 5000,
            "Inedible: invalid min supply"
        );
        minSupplyPct = _minSupplyPct;
    }

    function transferOwnership(address _newDao) external onlyDao {
        pendingDao = _newDao;
    }

    function renounceOwnership() external onlyDao {
        delete dao;
    }

    function acceptOwnership() external {
        require(msg.sender == pendingDao, "Inedible: not pending dao");
        dao = pendingDao;
        delete pendingDao;
    }
}

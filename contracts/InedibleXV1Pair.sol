// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.5.16;

import "./interfaces/IInedibleXV1Pair.sol";
import "./InedibleXV1ERC20.sol";
import "./libraries/Math.sol";
import "./libraries/UQ112x112.sol";
import "./interfaces/IERC20.sol";
import "./interfaces/IInedibleXV1Factory.sol";
import "./interfaces/IUniswapV2Callee.sol";
import "./interfaces/IRewards.sol";

contract InedibleXV1Pair is IInedibleXV1Pair, InedibleXV1ERC20 {
    using SafeMath for uint;
    using SafeMath for uint40;
    using UQ112x112 for uint224;

    uint public constant MINIMUM_LIQUIDITY = 10 ** 3;
    bytes4 private constant SELECTOR =
        bytes4(keccak256(bytes("transfer(address,uint256)")));

    address public factory;
    address public token0;
    address public token1;

    uint public price0CumulativeLast;
    uint public price1CumulativeLast;

    // Variables below added by Inedible
    address private constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    // Denominator for percent math. Numerator of 1,000 == 10%.
    uint256 public constant DENOM = 10000;
    // Whether or not this was a launch of a token.
    bool public launch;
    // This will equal block.timestamp once 2 trades have occurred on the block.
    uint40 private twoTrades;
    // The time that token vesting ends.
    uint40 public vestingEnd;
    // Minimum percent of a token that must be initially supplied.
    uint40 public initialLockDuration;
    uint16 public minSupplyPct;
    // Percent of tokens to send to the treasury from initial supply.
    uint16 public launchFeePct;
    // Amount of tokens bought from the dex. Avoids dumping.
    mapping(address => uint256) private buyBalance;

    function getReserves()
        public
        view
        returns (
            uint112 _reserve0,
            uint112 _reserve1,
            uint32 _blockTimestampLast
        )
    {
        _reserve0 = reserve0;
        _reserve1 = reserve1;
        _blockTimestampLast = blockTimestampLast;
    }

    function _safeTransfer(address token, address to, uint value) private {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(SELECTOR, to, value)
        );
        require(
            success && (data.length == 0 || abi.decode(data, (bool))),
            "UniswapV2: TRANSFER_FAILED"
        );
    }

    event Mint(address indexed sender, uint amount0, uint amount1);
    event Burn(
        address indexed sender,
        uint amount0,
        uint amount1,
        address indexed to
    );
    event Swap(
        address indexed sender,
        uint amount0In,
        uint amount1In,
        uint amount0Out,
        uint amount1Out,
        address indexed to
    );
    event Sync(uint112 reserve0, uint112 reserve1);

    constructor() public {
        factory = msg.sender;
    }

    // called once by the factory at time of deployment
    function initialize(
        address _token0,
        address _token1,
        uint16 _minSupplyPct,
        uint16 _launchFeePct,
        bool _launch,
        uint40 _lockDuration,
        uint40 _vestingDuration,
        address _deployer
    ) external {
        require(msg.sender == factory, "UniswapV2: FORBIDDEN"); // sufficient check
        token0 = _token0;
        token1 = _token1;

        // Add launch variable
        if (_launch) {
            launch = true;

            // Added by Inedible
            minSupplyPct = _minSupplyPct;
            launchFeePct = _launchFeePct;
            uint40 timestamp = uint40(block.timestamp);
            // won't overflow, router restricts vesting < 365 days
            vestingEnd = timestamp + _vestingDuration;
            initialLockDuration = _lockDuration;
        }
    }

    // update reserves and, on the first call per block, price accumulators
    function _update(
        uint balance0,
        uint balance1,
        uint112 _reserve0,
        uint112 _reserve1
    ) private {
        require(
            balance0 <= uint112(-1) && balance1 <= uint112(-1),
            "UniswapV2: OVERFLOW"
        );
        uint32 blockTimestamp = uint32(block.timestamp % 2 ** 32);
        uint32 timeElapsed = blockTimestamp - blockTimestampLast; // overflow is desired
        if (timeElapsed > 0 && _reserve0 != 0 && _reserve1 != 0) {
            // * never overflows, and + overflow is desired
            price0CumulativeLast +=
                uint(UQ112x112.encode(_reserve1).uqdiv(_reserve0)) *
                timeElapsed;
            price1CumulativeLast +=
                uint(UQ112x112.encode(_reserve0).uqdiv(_reserve1)) *
                timeElapsed;
        }
        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
        // Added by Inedible
        // If 1 trade has already been made, save that a second trade is happening.
        // If a second trade has already occurred this block, revert.
        if (timeElapsed == 0) {
            require(
                twoTrades < block.timestamp,
                "Two trades have already occurred on this block."
            );
            twoTrades = uint40(block.timestamp);
        }

        blockTimestampLast = blockTimestamp;
        emit Sync(reserve0, reserve1);
    }

    // if fee is on, mint liquidity equivalent to 1/6th of the growth in sqrt(k)
    function _mintFee(
        uint112 _reserve0,
        uint112 _reserve1
    ) internal returns (bool feeOn) {
        address feeTo = IInedibleXV1Factory(factory).treasury();
        feeOn = feeTo != address(0);
        uint _kLast = kLast; // gas savings
        if (feeOn) {
            if (_kLast != 0) {
                uint rootK = Math.sqrt(uint(_reserve0).mul(_reserve1));
                uint rootKLast = Math.sqrt(_kLast);
                if (rootK > rootKLast) {
                    uint256 _totalSupply = totalSupply;
                    uint numerator = _totalSupply.mul(rootK.sub(rootKLast));
                    uint denominator = rootK.mul(5).add(rootKLast);
                    uint liquidity = numerator / denominator;
                    if (liquidity > 0) {
                        // protocol fees
                        _mint(feeTo, liquidity);

                        // address1 is where we store lp fees and
                        // that balance should not be owed fees
                        uint addr1BalBefore = balanceOf[address(1)];
                        // liquidity provider fees
                        // This is a storage address to hold the rest of the fees.
                        // It's not the most efficient way to distribute fees separately from
                        // initial tokens, but it's the one that requires the least code changes.
                        _mint(address(1), liquidity.mul(5));

                        cumulativeFees = cumulativeFees.add(
                            liquidity.mul(5).mul(1e18).div(
                                _totalSupply - addr1BalBefore
                            )
                        );
                    }
                }
            }
        } else if (_kLast != 0) {
            kLast = 0;
        }
    }

    // this low-level function should be called from a contract which performs important safety checks
    function mint(address to) external lock returns (uint liquidity) {
        (uint112 _reserve0, uint112 _reserve1, ) = getReserves(); // gas savings
        uint balance0 = IERC20(token0).balanceOf(address(this));
        uint balance1 = IERC20(token1).balanceOf(address(this));
        uint amount0 = balance0.sub(_reserve0);
        uint amount1 = balance1.sub(_reserve1);

        // Added by Inedible
        // Specific actions on adding first liquidity, must come before amounts are counted
        // Token 0 is forced to be the launching one by requiring minSupply > 50%
        IERC20 launchToken = token0 == WETH ? IERC20(token1) : IERC20(token0);

        uint launchAmount = token0 == WETH ? amount1 : amount0;

        if (totalSupply == 0 && launch) {
            uint256 tokenSupply = launchToken.totalSupply();
            uint256 launchFee = (tokenSupply * launchFeePct) / DENOM;
            uint256 minSupply = (tokenSupply * minSupplyPct) / DENOM;
            // Ends with tokens in pool actually less than amount0 because the treasury is sent a %
            require(minSupply <= launchAmount, "Not enough tokens supplied.");

            lockedUntil[to] = block.timestamp.add(initialLockDuration);
            address feeTo = IInedibleXV1Factory(factory).feeTo();
            launchToken.approve(feeTo, launchFee);
            IRewards(feeTo).payFee(address(launchToken), launchFee);

            // update amount0 and balance0 because the treasury took a fee
            amount0 = amount0.sub(launchFee);
            balance0 = balance0.sub(launchFee);
        }

        bool feeOn = _mintFee(_reserve0, _reserve1);
        uint _totalSupply = totalSupply; // gas savings, must be defined here since totalSupply can update in _mintFee
        if (_totalSupply == 0) {
            liquidity = Math.sqrt(amount0.mul(amount1)).sub(MINIMUM_LIQUIDITY);
            _mint(address(0), MINIMUM_LIQUIDITY); // permanently lock the first MINIMUM_LIQUIDITY tokens
        } else {
            liquidity = Math.min(
                amount0.mul(_totalSupply) / _reserve0,
                amount1.mul(_totalSupply) / _reserve1
            );
        }
        require(liquidity > 0, "UniswapV2: INSUFFICIENT_LIQUIDITY_MINTED");
        _mint(to, liquidity);

        _update(balance0, balance1, _reserve0, _reserve1);
        if (feeOn) kLast = uint(reserve0).mul(reserve1); // reserve0 and reserve1 are up-to-date
        emit Mint(msg.sender, amount0, amount1);
    }

    // this low-level function should be called from a contract which performs important safety checks
    function burn(address to) public lock returns (uint amount0, uint amount1) {
        (amount0, amount1) = _burnHelper(to, false);
    }

    function _burnHelper(
        address to,
        bool fromClaim
    ) private returns (uint amount0, uint amount1) {
        (uint112 _reserve0, uint112 _reserve1, ) = getReserves(); // gas savings
        bool feeOn;

        if (!fromClaim) {
            feeOn = _mintFee(_reserve0, _reserve1);
        }

        address _token0 = token0; // gas savings
        address _token1 = token1; // gas savings
        uint balance0 = IERC20(_token0).balanceOf(address(this));
        uint balance1 = IERC20(_token1).balanceOf(address(this));
        uint liquidity = balanceOf[address(this)];

        uint _totalSupply = totalSupply; // gas savings, must be defined here since totalSupply can update in _mintFee
        amount0 = liquidity.mul(balance0) / _totalSupply; // using balances ensures pro-rata distribution
        amount1 = liquidity.mul(balance1) / _totalSupply; // using balances ensures pro-rata distribution
        require(
            amount0 > 0 && amount1 > 0,
            "UniswapV2: INSUFFICIENT_LIQUIDITY_BURNED"
        );
        _burn(address(this), liquidity);
        _safeTransfer(_token0, to, amount0);
        _safeTransfer(_token1, to, amount1);
        balance0 = IERC20(_token0).balanceOf(address(this));
        balance1 = IERC20(_token1).balanceOf(address(this));

        _update(balance0, balance1, _reserve0, _reserve1);
        if (feeOn) kLast = uint(reserve0).mul(reserve1); // reserve0 and reserve1 are up-to-date
        emit Burn(msg.sender, amount0, amount1, to);
    }

    // this low-level function should be called from a contract which performs important safety checks
    function swap(
        uint amount0Out,
        uint amount1Out,
        address to,
        bytes calldata data
    ) external lock {
        require(
            amount0Out > 0 || amount1Out > 0,
            "UniswapV2: INSUFFICIENT_OUTPUT_AMOUNT"
        );
        (uint112 _reserve0, uint112 _reserve1, ) = getReserves(); // gas savings
        require(
            amount0Out < _reserve0 && amount1Out < _reserve1,
            "UniswapV2: INSUFFICIENT_LIQUIDITY"
        );

        uint balance0;
        uint balance1;
        {
            // scope for _token{0,1}, avoids stack too deep errors
            address _token0 = token0;
            address _token1 = token1;
            require(to != _token0 && to != _token1, "UniswapV2: INVALID_TO");
            if (amount0Out > 0) _safeTransfer(_token0, to, amount0Out); // optimistically transfer tokens
            if (amount1Out > 0) _safeTransfer(_token1, to, amount1Out); // optimistically transfer tokens
            if (data.length > 0)
                IUniswapV2Callee(to).uniswapV2Call(
                    msg.sender,
                    amount0Out,
                    amount1Out,
                    data
                );
            balance0 = IERC20(_token0).balanceOf(address(this));
            balance1 = IERC20(_token1).balanceOf(address(this));
        }
        uint amount0In = balance0 > _reserve0 - amount0Out
            ? balance0 - (_reserve0 - amount0Out)
            : 0;
        uint amount1In = balance1 > _reserve1 - amount1Out
            ? balance1 - (_reserve1 - amount1Out)
            : 0;
        require(
            amount0In > 0 || amount1In > 0,
            "UniswapV2: INSUFFICIENT_INPUT_AMOUNT"
        );
        {
            // scope for reserve{0,1}Adjusted, avoids stack too deep errors
            uint balance0Adjusted = balance0.mul(10000).sub(amount0In.mul(36));
            uint balance1Adjusted = balance1.mul(10000).sub(amount1In.mul(36));
            require(
                balance0Adjusted.mul(balance1Adjusted) >=
                    uint(_reserve0).mul(_reserve1).mul(10000 ** 2),
                "UniswapV2: K"
            );
        }

        // Added by Inedible
        // This could technically be used to grief, but only by sending money to the person being "griefed"
        if (launch && block.timestamp < vestingEnd) {
            // If token0 is not WETH, it's the launch token that we need to restrict sells on.
            bool token0IsLaunch = token0 != WETH;

            // we check for tokenIn to be equal to zero because this low
            // level function can be used to bypass vesting by sending
            // vested token to contract and calling swap which will
            // update buyBalance and allow for a sell.
            if (
                token0IsLaunch
                    ? amount0Out > 0 && amount0In == 0
                    : amount1Out > 0 && amount1In == 0
            ) {
                buyBalance[to] = buyBalance[to].add(
                    token0IsLaunch ? amount0Out : amount1Out
                );
            } else {
                buyBalance[to] = buyBalance[to].sub(
                    token0IsLaunch ? amount0In : amount1In
                );
            }
        }

        _update(balance0, balance1, _reserve0, _reserve1);
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    // Added by Inedible
    function extendLock(uint256 _extension) external {
        lockedUntil[msg.sender] = lockedUntil[msg.sender].add(_extension);
    }

    // force balances to match reserves
    function skim(address to) external lock {
        address _token0 = token0; // gas savings
        address _token1 = token1; // gas savings
        _safeTransfer(
            _token0,
            to,
            IERC20(_token0).balanceOf(address(this)).sub(reserve0)
        );
        _safeTransfer(
            _token1,
            to,
            IERC20(_token1).balanceOf(address(this)).sub(reserve1)
        );
    }

    // force reserves to match balances
    function sync() external lock {
        _update(
            IERC20(token0).balanceOf(address(this)),
            IERC20(token1).balanceOf(address(this)),
            reserve0,
            reserve1
        );
    }
}

// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.5.16;

import "./interfaces/IUniswapV2ERC20.sol";
import "./libraries/SafeMath.sol";

contract InedibleXV1ERC20 is IUniswapV2ERC20 {
    using SafeMath for uint;

    string public constant name = "inedibleX V1";
    string public constant symbol = "ineX-V1";
    uint public totalSupply;

    uint112 internal reserve0; // uses single storage slot, accessible via getReserves
    uint112 internal reserve1; // uses single storage slot, accessible via getReserves

    // pack variables to use single slot
    uint8 public constant decimals = 18;
    uint32 internal blockTimestampLast; //
    uint8 private unlocked = 1;

    uint public kLast; // reserve0 * reserve1, as of immediately after the most recent liquidity event

    mapping(address => uint) public balanceOf;
    mapping(address => mapping(address => uint)) public allowance;

    // Added by Inedible
    mapping(address => uint) public lockedUntil;
    // Last cumulative fee per token amount a user has withdrawn.
    mapping(address => uint) public lastUserCumulative;
    // Fees ready to be claimed by user.
    mapping(address => uint256) public unclaimed;
    // Cumulative amount of fees generated per single full token.
    uint public cumulativeFees;

    bytes32 public DOMAIN_SEPARATOR;
    // keccak256("Permit(address owner,address spender,uint value,uint nonce,uint deadline)");
    bytes32 public constant PERMIT_TYPEHASH =
        0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9;
    mapping(address => uint) public nonces;

    event Approval(address indexed owner, address indexed spender, uint value);
    event Transfer(address indexed from, address indexed to, uint value);

    modifier lock() {
        require(unlocked == 1, "UniswapV2: LOCKED");
        unlocked = 0;
        _;
        unlocked = 1;
    }

    constructor() public {
        uint chainId;
        assembly {
            chainId := chainid
        }
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes(name)),
                keccak256(bytes("1")),
                chainId,
                address(this)
            )
        );
    }

    function _mint(address to, uint value) internal {
        _updateFees(to);
        totalSupply = totalSupply.add(value);
        balanceOf[to] = balanceOf[to].add(value);
        emit Transfer(address(0), to, value);
    }

    function _burn(address from, uint value) internal {
        _updateFees(from);
        balanceOf[from] = balanceOf[from].sub(value);
        totalSupply = totalSupply.sub(value);
        emit Transfer(from, address(0), value);
    }

    function _approve(address owner, address spender, uint value) private {
        allowance[owner][spender] = value;
        emit Approval(owner, spender, value);
    }

    function _transfer(
        address from,
        address to,
        uint value,
        bool fromClaimFees
    ) private {
        // Here we need to give users more fees and update
        require(lockedUntil[from] < block.timestamp, "User balance is locked.");

        if (!fromClaimFees) {
            _mintFee(reserve0, reserve1);

            _updateFees(from);
            _updateFees(to);
        }
        balanceOf[from] = balanceOf[from].sub(value);
        balanceOf[to] = balanceOf[to].add(value);

        emit Transfer(from, to, value);
    }

    // Virtual function to be called on the V2Pair contract.
    function _mintFee(
        uint112 _reserve0,
        uint112 _reserve1
    ) internal returns (bool feeOn) {}

    function _updateFees(address _user) internal {
        // Div buffer is because cumulative fees is based on a full token value.
        uint256 balance = balanceOf[_user];
        uint lastCumulative = lastUserCumulative[_user];
        // update cumulative fees here because we need to take care of transfer
        lastUserCumulative[_user] = cumulativeFees;

        if (balance == 0) return;

        uint256 feeAmount = balance
            .mul((cumulativeFees).sub(lastCumulative))
            .div(1e18);
        unclaimed[_user] = unclaimed[_user].add(feeAmount);
    }

    // Added by Inedible
    function claimFees(address _user) public lock {
        _mintFee(reserve0, reserve1);

        // Div buffer is because cumulative fees is based on a full token value.
        uint256 feeAmount = balanceOf[_user]
            .mul((cumulativeFees).sub(lastUserCumulative[_user]))
            .div(1e18);
        uint256 _unclaimed = unclaimed[_user];

        lastUserCumulative[_user] = cumulativeFees;
        if (feeAmount.add(_unclaimed) > 0) {
            _transfer(
                address(1),
                address(this),
                feeAmount.add(_unclaimed),
                true
            );
            unclaimed[_user] = 0;
            _burnHelper(_user, true);
        } else {
            kLast = uint(reserve0).mul(reserve1);
        }
    }

    // Added by Inedible
    function viewFees(address _user) public view returns (uint256) {
        // Div buffer is because cumulative fees is based on a full token value.
        uint256 feeAmount = balanceOf[_user]
            .mul((cumulativeFees).sub(lastUserCumulative[_user]))
            .div(1e18);
        uint256 _unclaimed = unclaimed[_user];

        return feeAmount.add(_unclaimed);
    }

    // Virtual function to be called on the V2Pair contract.
    function _burnHelper(
        address _user,
        bool _fromClaim
    ) private returns (uint amount0, uint amount1) {}

    function approve(address spender, uint value) external returns (bool) {
        _approve(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint value) external returns (bool) {
        _transfer(msg.sender, to, value, false);
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint value
    ) external returns (bool) {
        if (allowance[from][msg.sender] != uint(-1)) {
            allowance[from][msg.sender] = allowance[from][msg.sender].sub(
                value
            );
        }
        _transfer(from, to, value, false);
        return true;
    }

    function permit(
        address owner,
        address spender,
        uint value,
        uint deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(deadline >= block.timestamp, "UniswapV2: EXPIRED");
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(
                    abi.encode(
                        PERMIT_TYPEHASH,
                        owner,
                        spender,
                        value,
                        nonces[owner]++,
                        deadline
                    )
                )
            )
        );
        address recoveredAddress = ecrecover(digest, v, r, s);
        require(
            recoveredAddress != address(0) && recoveredAddress == owner,
            "UniswapV2: INVALID_SIGNATURE"
        );
        _approve(owner, spender, value);
    }
}

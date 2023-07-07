import { BigNumber, utils, providers } from "ethers";
import { ethers } from "hardhat";

// CONSTANTS
export const TOTAL_SUPPLY = expandTo18Decimals(10000);
export const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
export const LAUNCH_FEE_PCT = BigNumber.from(100);
export const WETH_WHALE = "0x8EB8a3b98659Cce290402893d0123abb75E3ab28";
export const WETH_WHALE1 = "0x57757E3D981446D585Af0D9Ae4d7DF6D64647806";
export const TEST_ADDRESSES: [string, string] = [
  "0x2000000000000000000000000000000000000000",
  WETH,
];
export const EASE_MULTISIG = "0x1f28eD9D4792a567DaD779235c2b766Ab84D8E33";
export const MIN_SUPPLY_PCT = BigNumber.from(5000);
export const MIN_VESTING = BigNumber.from(2592000);
export const MIN_LOCK = BigNumber.from(2592000);

export const DEFAULT_LAUNCH_FEE_PCT = 100;
export const DEFAULT_MIN_SUPPLY_PCT = 5000;

export function expandTo18Decimals(n: number): BigNumber {
  return BigNumber.from(n).mul(BigNumber.from(10).pow(18));
}

export function getCreate2Address(
  factoryAddress: string,
  [tokenA, tokenB]: [string, string],
  bytecode: string
): string {
  const [token0, token1] =
    tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA];
  return utils.getCreate2Address(
    factoryAddress,
    utils.keccak256(
      utils.solidityPack(["address", "address"], [token0, token1])
    ),
    utils.keccak256(bytecode)
  );
}

export function encodePrice(reserve0: BigNumber, reserve1: BigNumber) {
  return [
    reserve1.mul(BigNumber.from(2).pow(112)).div(reserve0),
    reserve0.mul(BigNumber.from(2).pow(112)).div(reserve1),
  ];
}

export const MINIMUM_LIQUIDITY = BigNumber.from(10).pow(3);

export const UniswapVersion = "1";

export async function fastForward(seconds: number) {
  const signers = await ethers.getSigners();
  const signer = signers[0];
  await (signer.provider as providers.JsonRpcProvider).send(
    "evm_increaseTime",
    [seconds]
  );
}

export const getExpectedAmount = ({
  tokenInReserve,
  tokenOutReserve,
  amountIn,
}: {
  tokenInReserve: BigNumber;
  tokenOutReserve: BigNumber;
  amountIn: BigNumber;
}): BigNumber => {
  const amountInWithFee = amountIn.mul(9964);
  const numerator = amountInWithFee.mul(tokenOutReserve);
  const denominator = tokenInReserve.mul(10000).add(amountInWithFee);
  return numerator.div(denominator);
};

export async function mineNBlocks(n: number) {
  const signers = await ethers.getSigners();
  const signer = signers[0];
  await (signer.provider as providers.JsonRpcProvider).send("hardhat_mine", [
    ethers.utils.hexlify(n),
  ]);
}

export async function mineBlockNumber(n: number) {
  const signers = await ethers.getSigners();
  const signer = signers[0];
  await (signer.provider as providers.JsonRpcProvider).send("evm_mine", [n]);
}

export function getExpectedFees({
  tokenInReserve,
  tokenOutReserve,
  amountIn,
  feePercent,
}: {
  tokenInReserve: BigNumber;
  tokenOutReserve: BigNumber;
  amountIn: BigNumber;
  feePercent: BigNumber;
}) {
  const amountInWithFee = amountIn.mul(feePercent).div(1000);
  const numerator = amountInWithFee.mul(tokenOutReserve);
  const denominator = tokenInReserve.mul(1000).add(amountInWithFee);
  return numerator.div(denominator);
}

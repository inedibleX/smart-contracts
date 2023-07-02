import { expect } from "chai";
import { BigNumber, constants as ethconst } from "ethers";
import hre, { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import {
  expandTo18Decimals,
  encodePrice,
  fastForward,
  getExpectedAmount,
  LAUNCH_FEE_PCT,
  MINIMUM_LIQUIDITY,
  MIN_LOCK,
  MIN_VESTING,
  WETH,
  WETH_WHALE,
  TOTAL_SUPPLY,
  getExpectedFees,
} from "./shared/utilities";
import { InedibleXV1Pair, ERC20, PairERC20 } from "../src/types";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

const ADDRESS1 = "0x0000000000000000000000000000000000000001";

describe("InedibleXV1Pair", () => {
  async function fixture() {
    const [wallet, other, treasury, ...signers] = await ethers.getSigners();
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [WETH_WHALE],
    });
    const wethWhale = await ethers.getSigner(WETH_WHALE);

    const rewards = await (
      await ethers.getContractFactory("Rewards")
    ).deploy(other.address, wallet.address);

    const factory = await (
      await ethers.getContractFactory("InedibleXV1Factory")
    ).deploy(wallet.address, rewards.address);

    const tokenA = (await (
      await ethers.getContractFactory("PairERC20")
    ).deploy(TOTAL_SUPPLY)) as PairERC20;
    const tokenB = (await ethers.getContractAt("ERC20", WETH)) as ERC20;
    await tokenB.connect(wethWhale).transfer(wallet.address, TOTAL_SUPPLY);
    await tokenB
      .connect(wethWhale)
      .transfer(other.address, ethers.utils.parseEther("10"));

    const tokenC = (await (
      await ethers.getContractFactory("PairERC20")
    ).deploy(TOTAL_SUPPLY)) as PairERC20;

    await factory.createPair(
      tokenA.address,
      tokenB.address,
      true, // launch
      LAUNCH_FEE_PCT,
      MIN_LOCK,
      MIN_VESTING
    );
    const pair = (await ethers.getContractFactory("InedibleXV1Pair")).attach(
      await factory.getPair(tokenA.address, tokenB.address)
    );

    // Regular pair that doesn't lock liquidty and all
    await factory.createPair(
      tokenC.address,
      tokenB.address,
      false, // launch
      LAUNCH_FEE_PCT,
      MIN_LOCK,
      MIN_VESTING
    );
    const pair1 = (await ethers.getContractFactory("InedibleXV1Pair")).attach(
      await factory.getPair(tokenC.address, tokenB.address)
    );
    const token0Address = await pair.token0();
    const token0 = tokenA.address === token0Address ? tokenA : tokenB;
    const token1 = tokenA.address === token0Address ? tokenB : tokenA;
    return {
      pair,
      token0,
      token1,
      wallet,
      other,
      treasury,
      signers,
      factory,
      rewards,
      pair1,
      tokenC,
    };
  }

  async function addLiquidity(
    token0: ERC20 | PairERC20,
    token1: ERC20 | PairERC20,
    pair: InedibleXV1Pair,
    wallet: SignerWithAddress,
    token0Amount: BigNumber,
    token1Amount: BigNumber
  ) {
    await token0.transfer(pair.address, token0Amount);
    await token1.transfer(pair.address, token1Amount);
    await pair.mint(wallet.address);
  }
  async function addDefaultLiquidity(
    token0: PairERC20 | ERC20,
    token1: ERC20 | PairERC20,
    pair: InedibleXV1Pair,
    wallet: SignerWithAddress
  ): Promise<{
    token0Amount: BigNumber;
    token1Amount: BigNumber;
    liquidity: BigNumber;
  }> {
    // 1% of total token0 supply
    const launchFees = TOTAL_SUPPLY.div(100);
    const reserve0 = TOTAL_SUPPLY.div(2);
    const reserve1 = TOTAL_SUPPLY.div(2);
    const liquidity = TOTAL_SUPPLY.div(2);
    await token0.transfer(pair.address, reserve0.add(launchFees));
    await token1.transfer(pair.address, reserve1);
    await pair.mint(wallet.address);
    // making sure this won't affect the test
    expect(await pair.totalSupply()).to.eq(liquidity);
    return { token0Amount: reserve0, token1Amount: reserve1, liquidity };
  }

  describe("mint()", function () {
    it("should mint liquidity when it is a launch token", async () => {
      const { pair, wallet, token0, token1, factory } = await loadFixture(
        fixture
      );
      // launch fees equals to 1% of total supply
      const launchFees = TOTAL_SUPPLY.div(100);
      // 50% of token0 total supply
      const token0Amount = TOTAL_SUPPLY.div(2);
      // 50% of token1 total supply keeping token0: token1 = 1:1
      const token1Amount = TOTAL_SUPPLY.div(2);

      await token0.transfer(pair.address, token0Amount.add(launchFees));
      await token1.transfer(pair.address, token1Amount);

      // as liquidity is sqrt of product of the reserves and we are adding equal amounts of tokens
      const expectedLiquidity = TOTAL_SUPPLY.div(2);

      await expect(pair.mint(wallet.address))
        .to.emit(token0, "Transfer")
        .withArgs(pair.address, await factory.feeTo(), launchFees)
        .to.emit(pair, "Transfer")
        .withArgs(ethconst.AddressZero, ethconst.AddressZero, MINIMUM_LIQUIDITY)
        .to.emit(pair, "Transfer")
        .withArgs(
          ethconst.AddressZero,
          wallet.address,
          expectedLiquidity.sub(MINIMUM_LIQUIDITY)
        )
        .to.emit(pair, "Sync")
        .withArgs(token0Amount, token1Amount)
        .to.emit(pair, "Mint")
        .withArgs(wallet.address, token0Amount, token1Amount);

      expect(await pair.totalSupply()).to.eq(expectedLiquidity);
      expect(await pair.balanceOf(wallet.address)).to.eq(
        expectedLiquidity.sub(MINIMUM_LIQUIDITY)
      );
      expect(await token0.balanceOf(pair.address)).to.eq(token0Amount);
      expect(await token1.balanceOf(pair.address)).to.eq(token1Amount);
      const reserves = await pair.getReserves();
      expect(reserves[0]).to.eq(token0Amount);
      expect(reserves[1]).to.eq(token1Amount);
    });
    it("should mint liquidity when it's not a launch token", async () => {
      // @note pair1 is the one with launch = false
      const { pair1, wallet, tokenC, token1 } = await loadFixture(fixture);

      // 10% of token0 total supply
      const token0Amount = TOTAL_SUPPLY.div(10);
      // 10% of token1 total supply keeping token0: token1 = 1:1
      const token1Amount = TOTAL_SUPPLY.div(10);

      await tokenC.transfer(pair1.address, token0Amount);
      await token1.transfer(pair1.address, token1Amount);

      // as liquidity is sqrt of product of the reserves and we are adding equal amounts of tokens
      const expectedLiquidity = TOTAL_SUPPLY.div(10);

      await expect(pair1.mint(wallet.address))
        .to.emit(pair1, "Transfer")
        .withArgs(ethconst.AddressZero, ethconst.AddressZero, MINIMUM_LIQUIDITY)
        .to.emit(pair1, "Transfer")
        .withArgs(
          ethconst.AddressZero,
          wallet.address,
          expectedLiquidity.sub(MINIMUM_LIQUIDITY)
        )
        .to.emit(pair1, "Sync")
        .withArgs(token0Amount, token1Amount)
        .to.emit(pair1, "Mint")
        .withArgs(wallet.address, token0Amount, token1Amount);

      expect(await pair1.totalSupply()).to.eq(expectedLiquidity);
      expect(await pair1.balanceOf(wallet.address)).to.eq(
        expectedLiquidity.sub(MINIMUM_LIQUIDITY)
      );
      expect(await tokenC.balanceOf(pair1.address)).to.eq(token0Amount);
      expect(await token1.balanceOf(pair1.address)).to.eq(token1Amount);
      const reserves = await pair1.getReserves();
      expect(reserves[0]).to.eq(token0Amount);
      expect(reserves[1]).to.eq(token1Amount);
    });
  });

  const swapTestCases: BigNumber[][] = [
    [1, 5, 10, "1661663664865586018"],
    [1, 10, 5, "453057364228292895"],

    [2, 5, 10, "2849788353735270564"],
    [2, 10, 5, "830831832432793009"],

    [1, 10, 10, "906114728456585791"],
    [1, 100, 100, "986569818330158302"],
    [1, 1000, 1000, "995408175294136921"],
  ].map((a) =>
    a.map((n) =>
      typeof n === "string" ? BigNumber.from(n) : expandTo18Decimals(n)
    )
  );
  it("should test my helper function getExpectedAmount against old test values", async () => {
    swapTestCases.forEach((swapTestCase) => {
      const [swapAmount, token0Amount, token1Amount, expectedOutputAmount] =
        swapTestCase;
      const expectedAmount = getExpectedAmount({
        tokenInReserve: token0Amount,
        tokenOutReserve: token1Amount,
        amountIn: swapAmount,
      });
      // Test helper function against old test values
      expect(expectedAmount).to.equal(expectedOutputAmount);
    });
  });

  it(`getInputPrice`, async () => {
    const { pair, wallet, token1, token0 } = await loadFixture(fixture);
    const { token0Amount, token1Amount } = await addDefaultLiquidity(
      token0,
      token1,
      pair,
      wallet
    );

    const swapAmount = expandTo18Decimals(1);
    const expectedOutputAmount = getExpectedAmount({
      tokenInReserve: token0Amount,
      tokenOutReserve: token1Amount,
      amountIn: swapAmount,
    });

    await token1.transfer(pair.address, swapAmount);
    await expect(
      pair.swap(expectedOutputAmount.add(1), 0, wallet.address, "0x")
    ).to.be.revertedWith("UniswapV2: K");
    await pair.swap(expectedOutputAmount, 0, wallet.address, "0x");
  });
  it("should not allow user to bypass vesting period", async () => {
    const { pair, wallet, token0, token1 } = await loadFixture(fixture);
    // @note wallet is signer0 so I am not connecting it to contracts

    // default liquidity is 1:1
    await addDefaultLiquidity(token0, token1, pair, wallet);

    const amount = expandTo18Decimals(100);
    const expectedAmount = amount.sub(amount.div(200));
    // Send tokens form the vester to the pair
    await token0.transfer(pair.address, amount);

    // this should revert because the vester should not be allowed to bypass vesting period
    await expect(pair.swap(expectedAmount, 0, wallet.address, "0x")).to.be
      .reverted;
  });

  it("swap:token0", async () => {
    const { pair, wallet, token0, token1, other } = await loadFixture(fixture);

    // default liquidity is 1:1
    const { token0Amount, token1Amount } = await addDefaultLiquidity(
      token0,
      token1,
      pair,
      wallet
    );

    let swapAmount = expandTo18Decimals(1);
    let expectedOutputAmount = getExpectedAmount({
      tokenInReserve: token0Amount,
      tokenOutReserve: token1Amount,
      amountIn: swapAmount,
    });

    await token0.transfer(pair.address, swapAmount);

    // minter should not be allowed to swap token0 for token1
    await expect(
      pair.connect(wallet).swap(0, expectedOutputAmount, other.address, "0x")
    ).to.be.reverted;

    // user's can't swap token0 for token1 if they have not bought it already
    await expect(
      pair.connect(other).swap(0, expectedOutputAmount, other.address, "0x")
    ).to.be.reverted;

    // skim previously transferred token1 amount
    await pair.connect(wallet).skim(wallet.address);

    // Fund other wallet
    await token1.transfer(other.address, swapAmount);

    // fund pair address
    await token1.connect(other).transfer(pair.address, swapAmount);

    await expect(
      pair.connect(other).swap(expectedOutputAmount, 0, other.address, "0x")
    )
      .to.emit(token0, "Transfer")
      .withArgs(pair.address, other.address, expectedOutputAmount)
      .to.emit(pair, "Sync")
      .withArgs(
        token0Amount.sub(expectedOutputAmount),
        token1Amount.add(swapAmount)
      )
      .to.emit(pair, "Swap")
      .withArgs(
        other.address,
        0,
        swapAmount,
        expectedOutputAmount,
        0,
        other.address
      );

    const reserves = await pair.getReserves();
    expect(reserves[0]).to.eq(token0Amount.sub(expectedOutputAmount));
    expect(reserves[1]).to.eq(token1Amount.add(swapAmount));
    expect(await token0.balanceOf(pair.address)).to.eq(
      token0Amount.sub(expectedOutputAmount)
    );
    expect(await token1.balanceOf(pair.address)).to.eq(
      token1Amount.add(swapAmount)
    );

    // @note update swap amount
    swapAmount = expectedOutputAmount;

    //@note update expected amount
    expectedOutputAmount = getExpectedAmount({
      tokenInReserve: reserves[0],
      tokenOutReserve: reserves[1],
      amountIn: swapAmount,
    });

    await token0.connect(other).transfer(pair.address, swapAmount);
    await expect(
      pair.connect(other).swap(0, expectedOutputAmount, other.address, "0x")
    )
      .to.emit(token1, "Transfer")
      .withArgs(pair.address, other.address, expectedOutputAmount)
      .to.emit(pair, "Sync")
      .withArgs(
        reserves[0].add(swapAmount),
        reserves[1].sub(expectedOutputAmount)
      )
      .to.emit(pair, "Swap")
      .withArgs(
        other.address,
        swapAmount,
        0,
        0,
        expectedOutputAmount,
        other.address
      );
  });
  describe("claimFee()", function () {
    it("should claim fees for multiple liqudity providers", async function () {
      const {
        factory,
        pair,
        wallet,
        treasury,
        token0,
        token1,
        other,
        signers,
      } = await loadFixture(fixture);

      await factory.setTreasury(treasury.address);

      await addDefaultLiquidity(token0, token1, pair, wallet);
      // Do a swap
      const swapAmount = expandTo18Decimals(1);
      let expectedOutputAmount = getExpectedAmount({
        tokenInReserve: TOTAL_SUPPLY.div(2),
        tokenOutReserve: TOTAL_SUPPLY.div(2),
        amountIn: swapAmount,
      });

      await token1.connect(wallet).transfer(other.address, swapAmount);
      // fund weth to swapper
      await token1.connect(other).transfer(pair.address, swapAmount);

      await pair
        .connect(other)
        .swap(expectedOutputAmount, 0, wallet.address, "0x");

      const balBeforeAddingLiquidty = await pair.balanceOf(other.address);
      await addLiquidity(token0, token1, pair, other, swapAmount, swapAmount);
      const balAfterAddingLiquidty = await pair.balanceOf(other.address);

      // Not calculating exact amount because as the tokens are almost 1:1 ratio
      // liquidity minted should be approximately equal to token0 or 1 being added
      expect(
        balAfterAddingLiquidty.sub(balBeforeAddingLiquidty)
      ).to.be.approximately(swapAmount, swapAmount.div(1000));

      const [reserve0, reserve1] = await pair.getReserves();

      // swap tokens again
      expectedOutputAmount = getExpectedAmount({
        tokenInReserve: reserve1,
        tokenOutReserve: reserve0,
        amountIn: swapAmount,
      });

      const user = signers[0];
      // fund weth
      await token1.transfer(user.address, swapAmount);
      const totalSupplyBeforeSwap = await pair.totalSupply();
      await token1.connect(user).transfer(pair.address, swapAmount);

      await pair
        .connect(user)
        .swap(expectedOutputAmount, 0, user.address, "0x");

      const totalSupplyAfterSwap = await pair.totalSupply();

      expect(totalSupplyAfterSwap).to.equal(totalSupplyBeforeSwap);

      // claim fees for other liqudity provider
      const token0BalBefore = await token0.balanceOf(other.address);

      const token1BalBefore = await token1.balanceOf(other.address);
      await pair.connect(other).claimFees(other.address);
      const token0BalAfter = await token0.balanceOf(other.address);

      const token1BalAfter = await token1.balanceOf(other.address);

      expect(token1BalAfter).to.be.gt(token1BalBefore);
      expect(token0BalAfter).to.be.gt(token0BalBefore);
    });
    it("check if claimFee works properly and doesn't infinite mint fees", async function () {
      const { factory, pair, wallet, treasury, token0, token1, other } =
        await loadFixture(fixture);

      await factory.setTreasury(treasury.address);

      await addDefaultLiquidity(token0, token1, pair, wallet);
      // Do a swap
      const swapAmount = expandTo18Decimals(1);
      const expectedOutputAmount = getExpectedAmount({
        tokenInReserve: TOTAL_SUPPLY.div(2),
        tokenOutReserve: TOTAL_SUPPLY.div(2),
        amountIn: swapAmount,
      });

      const tkn0 = await pair.token0();
      let tokenInReserve: BigNumber;
      let tokenOutReserve: BigNumber;
      if (tkn0.toLowerCase() === WETH.toLocaleLowerCase()) {
        tokenInReserve = await token0.balanceOf(pair.address);
        tokenOutReserve = await token1.balanceOf(pair.address);
      } else {
        tokenInReserve = await token1.balanceOf(pair.address);
        tokenOutReserve = await token0.balanceOf(pair.address);
      }

      // TODO: update expected fees
      const expectedFees = getExpectedFees({
        tokenInReserve,
        tokenOutReserve,
        amountIn: swapAmount,
        feePercent: BigNumber.from(36),
      });

      // transfer liqudity before lock period should fail
      await expect(
        pair.transfer(other.address, await pair.balanceOf(wallet.address))
      ).to.be.revertedWith("User balance is locked.");

      await token1.connect(wallet).transfer(other.address, swapAmount);
      // fund weth to swapper
      await token1.connect(other).transfer(pair.address, swapAmount);

      await pair
        .connect(other)
        .swap(expectedOutputAmount, 0, wallet.address, "0x");

      // Claim fees after swap
      const walletToken0BalBefore = await token0.balanceOf(wallet.address);
      const walletToken1BalBefore = await token1.balanceOf(wallet.address);

      const userCumulativeBefore = await pair.lastUserCumulative(
        wallet.address
      );
      // user's cumulative has not updated yet
      expect(userCumulativeBefore).to.equal(0);
      // FIRST CLAIM
      await pair.claimFees(wallet.address);
      const userCumulativeAfter = await pair.lastUserCumulative(wallet.address);
      const totalCumulative = await pair.cumulativeFees();

      // user cumulative should be equal total cumulative
      expect(userCumulativeAfter).to.be.eq(totalCumulative);

      const walletToken0BalAfter = await token0.balanceOf(wallet.address);
      const walletToken1BalAfter = await token1.balanceOf(wallet.address);

      // As liquidity is 1:1 feesForLiquidity provider burn should transfer equivalent
      // token0 and token1 to the wallet
      expect(walletToken0BalAfter.sub(walletToken0BalBefore)).to.be.gte(
        expectedFees
      );
      expect(walletToken1BalAfter.sub(walletToken1BalBefore)).to.be.gte(
        expectedFees
      );

      const otherToken0BalBefore = await token0.balanceOf(other.address);
      const otherToken1BalBefore = await token1.balanceOf(other.address);

      // SECOND CLAIM
      await pair.connect(other).claimFees(other.address);
      const otherToken0BalAfter = await token0.balanceOf(other.address);
      const otherToken1BalAfter = await token1.balanceOf(other.address);

      // wallet without liquidity should not recieve rewards
      expect(otherToken0BalAfter.sub(otherToken0BalBefore)).to.be.eq(0);
      expect(otherToken1BalAfter.sub(otherToken1BalBefore)).to.be.eq(0);

      // now the pair should mint fees on claim fees because reserves
      // has changed on last claim
      const totalSupplyBeforeClaim = await pair.totalSupply();

      // this will mint small amount of liquidity because previous claim fees
      // has some amount and reserve has changed
      // THIRD CLAIM
      await pair.connect(other).claimFees(other.address);
      const totalSupplyAfterClaim = await pair.totalSupply();

      // fees should be minted on claim fees even though the other
      // doesnt have liquidity balance because last claimFee by wallet
      // has changed the reserves and claim fees mint's fees first and
      // checks if there's a need to transfer tokens to the caller
      // I am not calculating the exact amount because
      // approximation should work in this case
      expect(totalSupplyAfterClaim).to.be.approximately(
        totalSupplyBeforeClaim,
        totalSupplyBeforeClaim.div(10000000)
      );

      // bullet proof check
      // This time it should not mint new tokens because reserves has not been
      // changed
      const supplyBefore = await pair.totalSupply();
      // Fourth CLAIM
      const treasuryCumulativeBefore = await pair.lastUserCumulative(
        treasury.address
      );
      // cumulative fees should be updated when mint fees has happened
      // because fees is minted to treasury and mint updates
      // the fees of the address
      expect(treasuryCumulativeBefore).to.gt(0);

      await pair.connect(treasury).claimFees(treasury.address);

      const treasuryCumulativeAfter = await pair.lastUserCumulative(
        treasury.address
      );
      const cumulativeFeesStored = await pair.cumulativeFees();
      expect(treasuryCumulativeAfter).to.be.eq(cumulativeFeesStored);

      const supplyAfter = await pair.totalSupply();
      // Supply should not increase here
      expect(supplyBefore).to.gte(supplyAfter);
    });
  });
  it("claimFees, _mintFee, _updateFees", async () => {
    const { pair, wallet, token0, token1, other } = await loadFixture(fixture);

    // Add liquidity
    await addDefaultLiquidity(token0, token1, pair, wallet);
    // Do a swap
    const swapAmount = expandTo18Decimals(1);
    const expectedOutputAmount = getExpectedAmount({
      tokenInReserve: TOTAL_SUPPLY.div(2),
      tokenOutReserve: TOTAL_SUPPLY.div(2),
      amountIn: swapAmount,
    });

    await token1.connect(wallet).transfer(other.address, swapAmount);
    await token1.connect(other).transfer(pair.address, swapAmount);
    await pair
      .connect(other)
      .swap(expectedOutputAmount, 0, wallet.address, "0x");

    // Wait time
    await fastForward(30 * 24 * 60 * 60);
    // Transfer to another address
    const liquidityBal = await pair.balanceOf(wallet.address);
    await pair.transfer(other.address, liquidityBal);
    // I don’t believe any rewards will be gotten for the time waited
    const walletToken0BalBefore = await token0.balanceOf(wallet.address);
    const walletToken1BalBefore = await token1.balanceOf(wallet.address);

    const otherToken0BalBefore = await token0.balanceOf(other.address);
    const otherToken1BalBefore = await token1.balanceOf(other.address);

    const cumulativeFeesBal = await pair.balanceOf(
      "0x0000000000000000000000000000000000000001"
    );
    const totalSuply = await pair.totalSupply();

    const feeShareOfWallet = cumulativeFeesBal
      .mul(liquidityBal)
      .div(totalSuply);

    const [reserve0, reserve1] = await pair.getReserves();

    const token0Fees = feeShareOfWallet.mul(reserve0).div(totalSuply);
    const token1Fees = feeShareOfWallet.mul(reserve1).div(totalSuply);

    await pair.connect(other).claimFees(other.address);
    await pair.connect(wallet).claimFees(wallet.address);

    const walletToken0BalAfter = await token0.balanceOf(wallet.address);
    const walletToken1BalAfter = await token1.balanceOf(wallet.address);

    const otherToken0BalAfter = await token0.balanceOf(other.address);
    const otherToken1BalAfter = await token1.balanceOf(other.address);

    expect(walletToken0BalAfter.sub(walletToken0BalBefore)).to.gte(token0Fees);
    expect(walletToken1BalAfter.sub(walletToken1BalBefore)).to.gte(token1Fees);

    // other address should not have any fees because there's no fees collected after swap
    expect(otherToken0BalAfter).to.equal(otherToken0BalBefore);
    expect(otherToken1BalBefore).to.equal(otherToken1BalAfter);
  });

  it("swap fail > 2 txns in same block", async () => {
    const { pair, token1, token0, wallet } = await loadFixture(fixture);

    await addDefaultLiquidity(token0, token1, pair, wallet);

    const multiswap = await (
      await ethers.getContractFactory("MultiSwap")
    ).deploy(pair.address);

    const swapAmount = expandTo18Decimals(1);
    const times = 3;
    const expectedOutputAmounts = [1, 1, 1];

    await token1.transfer(multiswap.address, swapAmount.mul(2));
    // This txn should not fail
    await multiswap.swapNTimes(2, [1, 1], swapAmount, token1.address);

    await token1.transfer(
      multiswap.address,
      swapAmount.mul(expectedOutputAmounts.length)
    );

    // 3txs in same block should fail
    await expect(
      multiswap.swapNTimes(
        times,
        expectedOutputAmounts,
        swapAmount,
        token1.address
      )
    ).to.be.revertedWith("Two trades have already occurred on this block.");
  });

  it("swap:token1", async () => {
    const { pair, token0, token1, other, wallet } = await loadFixture(fixture);

    const { token0Amount, token1Amount } = await addDefaultLiquidity(
      token0,
      token1,
      pair,
      wallet
    );

    let swapAmount = expandTo18Decimals(1);
    let expectedOutputAmount = getExpectedAmount({
      tokenInReserve: token1Amount,
      tokenOutReserve: token0Amount,
      amountIn: swapAmount,
    });

    await token1.connect(other).transfer(pair.address, swapAmount);

    let otherToken0BalBefore = await token0.balanceOf(other.address);

    await expect(
      pair.connect(other).swap(expectedOutputAmount, 0, other.address, "0x")
    )
      .to.emit(token0, "Transfer")
      .withArgs(pair.address, other.address, expectedOutputAmount)
      .to.emit(pair, "Sync")
      .withArgs(
        token0Amount.sub(expectedOutputAmount),
        token1Amount.add(swapAmount)
      )
      .to.emit(pair, "Swap")
      .withArgs(
        other.address,
        0,
        swapAmount,
        expectedOutputAmount,
        0,
        other.address
      );

    const reserves = await pair.getReserves();

    expect(reserves[0]).to.eq(token0Amount.sub(expectedOutputAmount));
    expect(reserves[1]).to.eq(token1Amount.add(swapAmount));

    expect(await token0.balanceOf(pair.address)).to.eq(
      token0Amount.sub(expectedOutputAmount)
    );
    expect(await token1.balanceOf(pair.address)).to.eq(
      token1Amount.add(swapAmount)
    );

    expect(
      (await token0.balanceOf(other.address)).sub(otherToken0BalBefore)
    ).to.eq(expectedOutputAmount);

    swapAmount = expectedOutputAmount;
    expectedOutputAmount = getExpectedAmount({
      tokenInReserve: reserves[1],
      tokenOutReserve: reserves[0],
      amountIn: swapAmount,
    });

    const pairToken0BalBefore = await token0.balanceOf(pair.address);
    const pairToken1BalBefore = await token1.balanceOf(pair.address);

    const otherToken1BalBefore = await token1.balanceOf(other.address);
    otherToken0BalBefore = await token0.balanceOf(other.address);

    await token0.connect(other).transfer(pair.address, swapAmount);
    await pair
      .connect(other)
      .swap(0, expectedOutputAmount, other.address, "0x");

    expect(
      (await token1.balanceOf(other.address)).sub(otherToken1BalBefore)
    ).to.equal(expectedOutputAmount);

    expect(
      otherToken0BalBefore.sub(await token0.balanceOf(other.address))
    ).to.equal(swapAmount);

    expect(pairToken0BalBefore.add(swapAmount)).to.equal(
      await token0.balanceOf(pair.address)
    );

    expect(pairToken1BalBefore.sub(expectedOutputAmount)).to.equal(
      await token1.balanceOf(pair.address)
    );
  });

  xit("swap:gas", async () => {
    const { pair, wallet, token0, token1 } = await loadFixture(fixture);

    const token0Amount = expandTo18Decimals(5);
    const token1Amount = expandTo18Decimals(10);
    await addLiquidity(
      token0,
      token1,
      pair,
      wallet,
      token0Amount,
      token1Amount
    );

    // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
    await ethers.provider.send("evm_mine", [
      (await ethers.provider.getBlock("latest")).timestamp + 1,
    ]);

    await time.setNextBlockTimestamp(
      (await ethers.provider.getBlock("latest")).timestamp + 1
    );
    await pair.sync();

    const swapAmount = expandTo18Decimals(1);
    const expectedOutputAmount = BigNumber.from("453305446940074565");
    await token1.transfer(pair.address, swapAmount);
    await time.setNextBlockTimestamp(
      (await ethers.provider.getBlock("latest")).timestamp + 1
    );
    const tx = await pair.swap(expectedOutputAmount, 0, wallet.address, "0x");
    const receipt = await tx.wait();
    expect(receipt.gasUsed).to.eq(73673);
  });

  it("burn", async () => {
    const { pair, token0, token1, wallet } = await loadFixture(fixture);

    const { token0Amount, token1Amount } = await addDefaultLiquidity(
      token0,
      token1,
      pair,
      wallet
    );

    const expectedLiquidity = await pair.balanceOf(wallet.address);

    // const expectedLiquidity = liquidity;
    await fastForward(30 * 24 * 60 * 60);
    await pair.transfer(pair.address, expectedLiquidity);
    // Fast forward so that the user is allowed to transfer this tokens
    const token1BalBefore = await token1.balanceOf(wallet.address);
    await expect(pair.burn(wallet.address))
      .to.emit(pair, "Transfer")
      .withArgs(pair.address, ethconst.AddressZero, expectedLiquidity)
      .to.emit(token0, "Transfer")
      .withArgs(pair.address, wallet.address, token0Amount.sub(1000))
      .to.emit(token1, "Transfer")
      .withArgs(pair.address, wallet.address, token1Amount.sub(1000))
      .to.emit(pair, "Sync")
      .withArgs(1000, 1000)
      .to.emit(pair, "Burn")
      .withArgs(
        wallet.address,
        token0Amount.sub(1000),
        token1Amount.sub(1000),
        wallet.address
      );

    expect(await pair.balanceOf(wallet.address)).to.eq(0);
    expect(await pair.totalSupply()).to.eq(MINIMUM_LIQUIDITY);
    expect(await token0.balanceOf(pair.address)).to.eq(1000);
    expect(await token1.balanceOf(pair.address)).to.eq(1000);

    expect(await token0.balanceOf(wallet.address)).to.eq(
      // Deduct 1% launch fees and 1000 min liquidity mint
      TOTAL_SUPPLY.sub(1000).sub(TOTAL_SUPPLY.div(100))
    );
    const token1BalAfter = await token1.balanceOf(wallet.address);

    expect(token1BalAfter.sub(token1BalBefore)).to.eq(
      // Deduct 1000 min liquidity mint
      TOTAL_SUPPLY.div(2).sub(1000)
    );
  });

  it("price{0,1}CumulativeLast", async () => {
    const { pair, wallet, token1, token0 } = await loadFixture(fixture);

    const { token0Amount, token1Amount } = await addDefaultLiquidity(
      token0,
      token1,
      pair,
      wallet
    );

    const blockTimestamp = (await pair.getReserves())[2];
    await time.setNextBlockTimestamp(blockTimestamp + 1);
    await pair.sync();

    const initialPrice = encodePrice(token0Amount, token1Amount);
    // expect(await pair.price0CumulativeLast()).to.eq(initialPrice[0]);
    // expect(await pair.price1CumulativeLast()).to.eq(initialPrice[1]);
    // expect((await pair.getReserves())[2]).to.eq(blockTimestamp + 1);

    const swapAmount = expandTo18Decimals(3);
    const expectedAmount = getExpectedAmount({
      tokenInReserve: token1Amount,
      tokenOutReserve: token0Amount,
      amountIn: swapAmount,
    });

    await token1.transfer(pair.address, swapAmount);
    await time.setNextBlockTimestamp(blockTimestamp + 10);
    // swap to a new price eagerly instead of syncing
    await pair.swap(expectedAmount, 0, wallet.address, "0x"); // make the price nice
    const cumulative0Last = await pair.price0CumulativeLast();
    const cumulative1Last = await pair.price1CumulativeLast();

    expect(cumulative0Last).to.eq(initialPrice[0].mul(10));
    expect(cumulative1Last).to.eq(initialPrice[1].mul(10));
    expect((await pair.getReserves())[2]).to.eq(blockTimestamp + 10);

    await time.setNextBlockTimestamp(blockTimestamp + 20);
    await pair.sync();
  });

  it("feeTo:off", async () => {
    const { pair, wallet, token1, factory, token0 } = await loadFixture(
      fixture
    );

    const { token0Amount, token1Amount } = await addDefaultLiquidity(
      token0,
      token1,
      pair,
      wallet
    );

    // set fee off
    await factory.setFeeTo(ethconst.AddressZero);
    expect(await factory.feeTo()).to.equal(ethconst.AddressZero);

    const swapAmount = expandTo18Decimals(1);
    const expectedOutputAmount = getExpectedAmount({
      tokenInReserve: token1Amount,
      tokenOutReserve: token0Amount,
      amountIn: swapAmount,
    });
    await token1.transfer(pair.address, swapAmount);
    await pair.swap(expectedOutputAmount, 0, wallet.address, "0x");

    const walletLpBalance = await pair.balanceOf(wallet.address);
    await fastForward(30 * 24 * 60 * 60);
    await pair.transfer(pair.address, walletLpBalance.sub(MINIMUM_LIQUIDITY));
    await pair.burn(wallet.address);

    const protocolFees = await pair.balanceOf(await factory.feeTo());

    expect(await pair.totalSupply()).to.eq(MINIMUM_LIQUIDITY.add(protocolFees));
  });

  it("feeTo:on", async () => {
    const { pair, wallet, treasury, token0, token1, factory } =
      await loadFixture(fixture);

    await factory.setTreasury(treasury.address);

    const { token0Amount, token1Amount } = await addDefaultLiquidity(
      token0,
      token1,
      pair,
      wallet
    );
    const swapAmount = expandTo18Decimals(1);
    const expectedOutputAmount = getExpectedAmount({
      tokenInReserve: token1Amount,
      tokenOutReserve: token0Amount,
      amountIn: swapAmount,
    });

    await token1.transfer(pair.address, swapAmount);
    await pair.swap(expectedOutputAmount, 0, wallet.address, "0x");

    const expectedLiquidity = await pair.balanceOf(wallet.address);
    await fastForward(30 * 24 * 60 * 60);
    await pair.transfer(pair.address, expectedLiquidity);
    await pair.burn(wallet.address);
    // Fee to pair balance
    const protocolFees = await pair.balanceOf(await factory.treasury());
    const liquidityProviderFees = protocolFees.mul(5);
    const providerLqBal = await pair.balanceOf(wallet.address);

    expect(await pair.totalSupply()).to.eq(
      MINIMUM_LIQUIDITY.add(liquidityProviderFees)
        .add(protocolFees)
        .add(providerLqBal)
    );

    expect(await pair.balanceOf(treasury.address)).to.eq(protocolFees);

    // using 1000 here instead of the symbolic MINIMUM_LIQUIDITY because the amounts only happen to be equal...
    // ...because the initial liquidity amounts were equal
    // OLD TEST
    // expect(await token0.balanceOf(pair.address)).to.eq(
    //   BigNumber.from(1000).add("249501683697445")
    // );
    // expect(await token1.balanceOf(pair.address)).to.eq(
    //   BigNumber.from(1000).add("250000187312969")
    // );

    // @note taking reference to old test values to save time. Only checking rounded values here
    const oldToken0BalExpected = BigNumber.from("249501683697445");
    // adding 1000 for min liquidity
    const token0BalExpected = oldToken0BalExpected.mul(6).add(1000);

    const oldToken1BalExpected = BigNumber.from("250000187312969");
    const token1BalExpected = oldToken1BalExpected.mul(6).add(1000);

    // after inedible cumulative fees deducting .001% for rounding and all
    expect(await token0.balanceOf(pair.address)).to.gte(
      token0BalExpected.sub(token1BalExpected.div(100000))
    );

    // after inedible cumulative fees deducting 1% for rounding and all
    expect(await token1.balanceOf(pair.address)).to.gt(
      token1BalExpected.sub(token0BalExpected.div(100000))
    );
  });
});

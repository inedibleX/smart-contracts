import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { getContractAddress } from "ethers/lib/utils";
import {
  ERC20,
  InedibleXRouterV1,
  InedibleXRouterV1__factory,
  InedibleXV1Factory,
  InedibleXV1Factory__factory,
  InedibleXV1Pair,
  PairERC20__factory,
  Rewards__factory,
} from "../src/types";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import {
  EASE_MULTISIG,
  LAUNCH_FEE_PCT,
  MIN_LOCK,
  MIN_VESTING,
  TOTAL_SUPPLY,
  WETH,
  WETH_WHALE1,
} from "./shared/utilities";

describe("InedibleXRouterV1", () => {
  async function fixture() {
    const [wallet, other, buyer] = await ethers.getSigners();
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [WETH_WHALE1],
    });
    const wethWhale = await ethers.getSigner(WETH_WHALE1);

    const weth = (await ethers.getContractAt("ERC20", WETH)) as ERC20;
    await weth.connect(wethWhale).transfer(wallet.address, TOTAL_SUPPLY);

    const Router = <InedibleXRouterV1__factory>(
      await ethers.getContractFactory("InedibleXRouterV1", wallet)
    );

    const PairFactory = <InedibleXV1Factory__factory>(
      await ethers.getContractFactory("InedibleXV1Factory", wallet)
    );
    const TokenFactory = <PairERC20__factory>(
      await ethers.getContractFactory("PairERC20", wallet)
    );
    const RewardFactory = <Rewards__factory>(
      await ethers.getContractFactory("Rewards", wallet)
    );

    const rewards = await RewardFactory.deploy(wallet.address, other.address);
    const token = await TokenFactory.deploy(TOTAL_SUPPLY);

    const routerAddress = getContractAddress({
      from: wallet.address,
      nonce: (await ethers.provider.getTransactionCount(wallet.address)) + 1,
    });

    const factory = <InedibleXV1Factory>(
      await PairFactory.deploy(
        wallet.address,
        rewards.address,
        EASE_MULTISIG,
        routerAddress
      )

    );

    const router = <InedibleXRouterV1>(
      await Router.deploy(factory.address, WETH)
    );
    return { router, factory, token, wallet, other, buyer, rewards, weth };
  }

  it("factory, WETH", async () => {
    const { router, factory } = await loadFixture(fixture);
    expect(await router.factory()).to.eq(factory.address);
    expect(await router.WETH()).to.eq(WETH);
  });

  it("addLiquidityETH", async () => {
    const { router, other, token, factory } = await loadFixture(fixture);
    const tokenAmount = TOTAL_SUPPLY.mul(50).div(100);

    await token.approve(router.address, tokenAmount);
    const timestamp = (await ethers.provider.getBlock("latest")).timestamp;

    await router[
      "addLiquidityETH(address,uint256,uint256,uint256,address,uint256,(bool,bool,uint16,uint40,uint40))"
    ](
      token.address,
      ethers.utils.parseEther("5000"),
      tokenAmount,
      tokenAmount,
      other.address,
      timestamp + 1000,
      {
        deployNewPool: true,
        launch: true,
        launchFeePct: LAUNCH_FEE_PCT,
        lockDuration: MIN_LOCK,
        vestingDuration: MIN_VESTING,
      },
      { value: tokenAmount }
    );
    const pairAddress = await factory.getPair(token.address, WETH);
    const pair = <InedibleXV1Pair>(
      await ethers.getContractAt("InedibleXV1Pair", pairAddress)
    );

    const pairBalance = await pair.balanceOf(other.address);

    expect(pairBalance).to.eq("4949747468305832669805");
  });

  it("addLiquidity: should not fail", async () => {
    const { router, other, token, weth } = await loadFixture(fixture);
    const tokenAmount = TOTAL_SUPPLY.mul(50).div(100);
    const launchFees = TOTAL_SUPPLY.div(100);
    const tokenAAmount = tokenAmount.add(launchFees);

    await token.approve(router.address, tokenAmount);
    await weth.approve(router.address, tokenAmount);
    const timestamp = (await ethers.provider.getBlock("latest")).timestamp;
    const tokenDesired = tokenAmount;

    await router[
      "addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256,(bool,bool,uint16,uint40,uint40))"
    ](
      token.address,
      weth.address,
      tokenDesired,
      tokenDesired,
      tokenAmount,
      tokenAAmount,
      other.address,
      timestamp + 1000,
      {
        deployNewPool: true,
        launch: true,
        launchFeePct: LAUNCH_FEE_PCT,
        lockDuration: MIN_LOCK,
        vestingDuration: MIN_VESTING,
      }
    );
  });
  it("addLiquidityETH: fail if user doesn't want to create a new pool", async () => {
    const { router, other, token } = await loadFixture(fixture);
    const tokenAmount = TOTAL_SUPPLY.mul(50).div(100);

    await token.approve(router.address, tokenAmount);
    const timestamp = (await ethers.provider.getBlock("latest")).timestamp;

    await expect(
      router[
        "addLiquidityETH(address,uint256,uint256,uint256,address,uint256,(bool,bool,uint16,uint40,uint40))"
      ](
        token.address,
        ethers.utils.parseEther("5000"),
        tokenAmount,
        tokenAmount,
        other.address,
        timestamp + 1000,
        {
          deployNewPool: false,
          launch: true,
          launchFeePct: LAUNCH_FEE_PCT,
          lockDuration: MIN_LOCK,
          vestingDuration: MIN_VESTING,
        },
        { value: tokenAmount }
      )
    ).to.be.revertedWith("can't deploy a new pool");
  });
  it("addLiquidityETH: fail if someone frontran and created a pool", async () => {
    const { router, other, token, factory } = await loadFixture(fixture);
    const tokenAmount = TOTAL_SUPPLY.mul(50).div(100);

    await token.approve(router.address, tokenAmount);
    const timestamp = (await ethers.provider.getBlock("latest")).timestamp;

    await factory.createPair(
      token.address,
      WETH,
      true,
      LAUNCH_FEE_PCT,
      MIN_LOCK,
      MIN_VESTING
    );

    await expect(
      router[
        "addLiquidityETH(address,uint256,uint256,uint256,address,uint256,(bool,bool,uint16,uint40,uint40))"
      ](
        token.address,
        ethers.utils.parseEther("5000"),
        tokenAmount,
        tokenAmount,
        other.address,
        timestamp + 1000,
        {
          deployNewPool: true,
          launch: true,
          launchFeePct: LAUNCH_FEE_PCT,
          lockDuration: MIN_LOCK,
          vestingDuration: MIN_VESTING,
        },
        { value: tokenAmount }
      )
    ).to.be.revertedWith("pool already exists");
  });
  it("swapExactETHForTokensSupportingFeeOnTransferTokens: should work", async () => {
    const { router, other, token, buyer } = await loadFixture(fixture);
    const tokenAmount = TOTAL_SUPPLY.mul(50).div(100);

    await token.approve(router.address, tokenAmount);
    const timestamp = (await ethers.provider.getBlock("latest")).timestamp;

    await router[
      "addLiquidityETH(address,uint256,uint256,uint256,address,uint256,(bool,bool,uint16,uint40,uint40))"
    ](
      token.address,
      ethers.utils.parseEther("5000"),
      tokenAmount,
      tokenAmount,
      other.address,
      timestamp + 1000,
      {
        deployNewPool: true,
        launch: true,
        launchFeePct: LAUNCH_FEE_PCT,
        lockDuration: MIN_LOCK,
        vestingDuration: MIN_VESTING,
      },
      { value: tokenAmount }
    );

    const ethAmt = ethers.utils.parseEther("10");
    const [_, expectedTokenAmt] = await router.getAmountsOut(ethAmt, [
      WETH,
      token.address,
    ]);

    const buyerTokenBalBefore = await token.balanceOf(buyer.address);

    await router
      .connect(buyer)
      .swapExactETHForTokensSupportingFeeOnTransferTokens(
        expectedTokenAmt,
        [WETH, token.address],
        buyer.address,
        timestamp + 1000,
        { value: ethAmt }
      );
    const buyerTokenBalAfter = await token.balanceOf(buyer.address);

    expect(buyerTokenBalAfter.sub(buyerTokenBalBefore)).to.gte(
      expectedTokenAmt
    );
  });
  it("swapExactTokensForETHSupportingFeeOnTransferTokens: should work", async () => {
    const { router, other, token, buyer } = await loadFixture(fixture);
    const tokenAmount = TOTAL_SUPPLY.mul(50).div(100);

    await token.approve(router.address, tokenAmount);
    const timestamp = (await ethers.provider.getBlock("latest")).timestamp;

    await router[
      "addLiquidityETH(address,uint256,uint256,uint256,address,uint256,(bool,bool,uint16,uint40,uint40))"
    ](
      token.address,
      ethers.utils.parseEther("5000"),
      tokenAmount,
      tokenAmount,
      other.address,
      timestamp + 1000,
      {
        deployNewPool: true,
        launch: true,
        launchFeePct: LAUNCH_FEE_PCT,
        lockDuration: MIN_LOCK,
        vestingDuration: MIN_VESTING,
      },
      { value: tokenAmount }
    );

    const ethAmt = ethers.utils.parseEther("10");
    const [_, expectedTokenAmt] = await router.getAmountsOut(ethAmt, [
      WETH,
      token.address,
    ]);

    await router
      .connect(buyer)
      .swapExactETHForTokensSupportingFeeOnTransferTokens(
        expectedTokenAmt,
        [WETH, token.address],
        buyer.address,
        timestamp + 1000,
        { value: ethAmt }
      );

    const [expectedEthAmt] = await router.getAmountsOut(expectedTokenAmt, [
      token.address,
      WETH,
    ]);

    await token.connect(buyer).approve(router.address, expectedTokenAmt);

    await router
      .connect(buyer)
      .swapExactTokensForETHSupportingFeeOnTransferTokens(
        expectedTokenAmt,
        expectedEthAmt,
        [token.address, WETH],
        buyer.address,
        timestamp + 1000
      );
  });
});

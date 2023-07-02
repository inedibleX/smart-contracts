import { ethers } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { IInedibleToken, Rewards } from "../src/types";
import { mine } from "@nomicfoundation/hardhat-network-helpers";
const INEDIBLE_TOKEN = "0x3486b751a36F731A1bEbFf779374baD635864919";
const INEDIBLE_WHALE = "0x52270c7c87073CEf04A8fdb38765394A29969Ae8";
const AIRDROP_AMOUNT = ethers.utils.parseEther("1000");

describe("Rewards", () => {
  let inedible: IInedibleToken;
  let rewards: Rewards;
  let wallet: SignerWithAddress;
  let other: SignerWithAddress;

  before(async function () {
    // impersonate the inedible whale
    await ethers.provider.send("hardhat_impersonateAccount", [INEDIBLE_WHALE]);
  });

  beforeEach(async function () {
    [wallet, other] = await ethers.getSigners();
    const Rewards = await ethers.getContractFactory("Rewards", wallet);
    await wallet.sendTransaction({
      to: INEDIBLE_WHALE,
      value: ethers.utils.parseEther("1"),
    });

    inedible = await ethers.getContractAt(
      "IInedibleToken",
      INEDIBLE_TOKEN,
      wallet
    );

    const inedibleWhale = await ethers.getSigner(INEDIBLE_WHALE);
    // send inedible to the wallet
    await inedible
      .connect(inedibleWhale)
      .transfer(wallet.address, ethers.utils.parseEther("1000000"));
    // send inedible to the wallet
    await inedible
      .connect(inedibleWhale)
      .transfer(other.address, ethers.utils.parseEther("1000000"));

    rewards = await Rewards.deploy(other.address, inedible.address);
  });

  it("should deploy with correct state variables", async () => {
    expect(await rewards.dao()).to.equal(other.address);
    // get storage value at slot 1
    const inedibleAddress = ethers.utils.hexStripZeros(
      await ethers.provider.getStorageAt(rewards.address, 1)
    );

    expect(inedibleAddress.toLowerCase()).to.equal(
      inedible.address.toLowerCase()
    );
  });
  it("Should send tokens for airdrop", async () => {
    //   rewards inedible balance before
    const inedibleBalanceBefore = await inedible.balanceOf(rewards.address);
    //   approve the rewards contract to spend inedible
    await inedible.connect(wallet).approve(rewards.address, AIRDROP_AMOUNT);

    const timePoint = (await ethers.provider.getBlock("latest")).number;
    await expect(rewards.payFee(inedible.address, AIRDROP_AMOUNT))
      .to.emit(rewards, "NewRewards")
      .withArgs(inedible.address, AIRDROP_AMOUNT, timePoint + 1);
    //   rewards inedible balance after
    const inedibleBalanceAfter = await inedible.balanceOf(rewards.address);

    expect(inedibleBalanceAfter.sub(inedibleBalanceBefore)).to.equal(
      AIRDROP_AMOUNT
    );

    const launchAmount = await rewards.launches(
      inedible.address,
      timePoint + 1
    );
    expect(launchAmount).to.equal(AIRDROP_AMOUNT);
  });
  it("should allow dao to withdraw airdrop token after 90 days", async function () {
    const blocksIn90Days = (90 * 24 * 60 * 60) / 12;
    await inedible.approve(rewards.address, AIRDROP_AMOUNT);
    const timePoint = (await ethers.provider.getBlock("latest")).number;
    await rewards.payFee(inedible.address, AIRDROP_AMOUNT);

    // fast forward blockchain blockNumber by 90 days
    await mine(blocksIn90Days, { interval: 12 });

    const otherInedibleBalBefore = await inedible.balanceOf(other.address);

    await rewards
      .connect(other)
      .daoWithdraw(inedible.address, timePoint + 1, other.address);
    const otherInedibleBalAfter = await inedible.balanceOf(other.address);

    expect(otherInedibleBalAfter.sub(otherInedibleBalBefore)).to.equal(
      AIRDROP_AMOUNT
    );
  });
  it("should not allow dao to withdraw airdrop token before 90 days", async function () {
    await inedible.approve(rewards.address, AIRDROP_AMOUNT);
    const timePoint = (await ethers.provider.getBlock("latest")).number;
    await rewards.payFee(inedible.address, AIRDROP_AMOUNT);
    await expect(
      rewards
        .connect(other)
        .daoWithdraw(inedible.address, timePoint + 1, other.address)
    ).to.be.revertedWith("Too early to withdraw fees");
  });
  it("Should allow indedible token holder to claim rewards after 30 days", async function () {
    const blocksIn30Days = (30 * 24 * 60 * 60) / 12;
    await inedible.connect(other).delegate(other.address);

    await inedible.approve(rewards.address, AIRDROP_AMOUNT);

    const timePoint = await ethers.provider.getBlockNumber();

    await rewards.payFee(inedible.address, AIRDROP_AMOUNT);
    //   fast forward blockchain timestamp by 30 days
    await mine(blocksIn30Days + 10, { interval: 12 });
    const otherInedibleBalBefore = await inedible.balanceOf(other.address);

    await expect(
      rewards
        .connect(other)
        .claimRewards(other.address, [inedible.address], [timePoint + 1])
    ).to.emit(rewards, "ClaimedReward");
    const otherInedibleBalAfter = await inedible.balanceOf(other.address);

    expect(otherInedibleBalAfter.sub(otherInedibleBalBefore)).to.be.gt(10000);
  });
  it("Should not allow indedible token holder to claim rewards before 30 days", async function () {
    await inedible.connect(other).delegate(other.address);

    await inedible.approve(rewards.address, AIRDROP_AMOUNT);

    const timePoint = await ethers.provider.getBlockNumber();

    await rewards.payFee(inedible.address, AIRDROP_AMOUNT);
    //   fast forward blockchain timestamp by 30 days

    await expect(
      rewards
        .connect(other)
        .claimRewards(other.address, [inedible.address], [timePoint + 1])
    ).to.be.revertedWith("Too early to claim rewards.");
  });
  it("Should not allow indedible token holder to claim rewards more than once", async function () {
    const blocksIn30Days = (30 * 24 * 60 * 60) / 12;
    await inedible.connect(other).delegate(other.address);

    await inedible.approve(rewards.address, AIRDROP_AMOUNT);

    const timePoint = await ethers.provider.getBlockNumber();

    await rewards.payFee(inedible.address, AIRDROP_AMOUNT);
    //   fast forward blockchain timestamp by 30 days
    await mine(blocksIn30Days + 10, { interval: 12 });

    await expect(
      rewards
        .connect(other)
        .claimRewards(other.address, [inedible.address], [timePoint + 1])
    ).to.emit(rewards, "ClaimedReward");

    await expect(
      rewards
        .connect(other)
        .claimRewards(other.address, [inedible.address], [timePoint + 1])
    ).to.be.revertedWith("Reward already claimed.");
  });
});

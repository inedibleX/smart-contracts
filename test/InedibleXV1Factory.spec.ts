import { expect } from "chai";
import { InedibleXV1Factory } from "../src/types";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import {
  DEFAULT_LAUNCH_FEE_PCT,
  EASE_MULTISIG,
  MIN_LOCK,
  MIN_VESTING,
  TEST_ADDRESSES,
  getCreate2Address,
} from "./shared/utilities";
import { ethers } from "hardhat";

describe("InedibleXV1Factory", () => {
  async function fixture() {
    const tmp = await ethers.getContractFactory("InedibleXV1Factory");
    const [wallet, other] = await ethers.getSigners();
    const factory = await tmp.deploy(
      wallet.address,
      other.address,
      EASE_MULTISIG,
      ethers.constants.AddressZero

    );
    return { factory: factory, wallet, other };
  }

  it("feeTo, feeToSetter, allPairsLength", async () => {
    const { factory, other, wallet } = await loadFixture(fixture);
    expect(await factory.feeTo()).to.eq(other.address);
    expect(await factory.allPairsLength()).to.eq(0);
    expect(await factory.dao()).to.eq(wallet.address);
  });

  async function createPair(
    factory: InedibleXV1Factory,
    tokens: [string, string]
  ) {
    const pairContract = await ethers.getContractFactory("InedibleXV1Pair");
    const create2Address = getCreate2Address(
      factory.address,
      tokens,
      pairContract.bytecode
    );
    await expect(
      factory.createPair(
        tokens[0],
        tokens[1],
        true,
        DEFAULT_LAUNCH_FEE_PCT,
        MIN_LOCK,
        MIN_VESTING
      )
    )
      .to.emit(factory, "PairCreated")
      .withArgs(TEST_ADDRESSES[0], TEST_ADDRESSES[1], create2Address, 1)
      .to.emit(factory, "InedibleCreated")
      .withArgs(
        TEST_ADDRESSES[0],
        TEST_ADDRESSES[1],
        create2Address,
        1,
        true,
        MIN_LOCK,
        MIN_VESTING
      );

    await expect(
      factory.createPair(
        tokens[0],
        tokens[1],
        true,
        DEFAULT_LAUNCH_FEE_PCT,
        MIN_LOCK,
        MIN_VESTING
      )
    ).to.be.reverted; // UniswapV2: PAIR_EXISTS
    await expect(
      factory.createPair(
        tokens[1],
        tokens[0],
        true,
        DEFAULT_LAUNCH_FEE_PCT,
        MIN_LOCK,
        MIN_VESTING
      )
    ).to.be.reverted; // UniswapV2: PAIR_EXISTS
    expect(await factory.getPair(tokens[0], tokens[1])).to.eq(create2Address);
    expect(await factory.getPair(tokens[1], tokens[0])).to.eq(create2Address);
    expect(await factory.allPairs(0)).to.eq(create2Address);
    expect(await factory.allPairsLength()).to.eq(1);

    const pair = pairContract.attach(create2Address);
    expect(await pair.factory()).to.eq(factory.address);
    expect(await pair.token0()).to.eq(TEST_ADDRESSES[0]);
    expect(await pair.token1()).to.eq(TEST_ADDRESSES[1]);
  }

  it("createPair", async () => {
    const { factory } = await loadFixture(fixture);
    await createPair(factory, [...TEST_ADDRESSES]);

    await expect(
      factory.createPair(
        TEST_ADDRESSES[1],
        "0x3000000000000000000000000000000000000000",
        true,
        DEFAULT_LAUNCH_FEE_PCT,
        MIN_LOCK.sub(1000),
        MIN_VESTING
      )
    ).to.be.revertedWith("Inedible: invalid lock duration");

    await expect(
      factory.createPair(
        TEST_ADDRESSES[1],
        "0x3000000000000000000000000000000000000000",
        true,
        DEFAULT_LAUNCH_FEE_PCT,
        MIN_LOCK,
        MIN_VESTING.sub(1000)
      )
    ).to.be.revertedWith("Inedible: invalid vesting duration");
  });

  it("createPair:reverse", async () => {
    const { factory } = await loadFixture(fixture);
    await createPair(
      factory,
      TEST_ADDRESSES.slice().reverse() as [string, string]
    );
  });
  it("createPair: should allow to pair against any token if not launch", async () => {
    const { factory } = await loadFixture(fixture);

    const pairContract = await ethers.getContractFactory("InedibleXV1Pair");
    const create2Address = getCreate2Address(
      factory.address,
      [TEST_ADDRESSES[0], TEST_ADDRESSES[1]],
      pairContract.bytecode
    );
    await expect(
      factory.createPair(
        TEST_ADDRESSES[0],
        TEST_ADDRESSES[1],
        false,
        DEFAULT_LAUNCH_FEE_PCT,
        MIN_LOCK,
        MIN_VESTING
      )
    )
      .to.emit(factory, "PairCreated")
      .withArgs(TEST_ADDRESSES[0], TEST_ADDRESSES[1], create2Address, 1)
      .to.emit(factory, "InedibleCreated")
      .withArgs(
        TEST_ADDRESSES[0],
        TEST_ADDRESSES[1],
        create2Address,
        1,
        false,
        0,
        0
      );
  });

  xit("createPair:gas", async () => {
    const { factory } = await loadFixture(fixture);
    const tx = await factory.createPair(
      ...TEST_ADDRESSES,
      true,
      DEFAULT_LAUNCH_FEE_PCT,
      MIN_LOCK,
      MIN_VESTING
    );
    const receipt = await tx.wait();
    expect(receipt.gasUsed).to.eq(2029585);
  });

  it("setTreasury", async () => {
    const { factory, wallet, other } = await loadFixture(fixture);
    expect(await factory.treasury()).to.eq(EASE_MULTISIG);
    await expect(
      factory.connect(other).setTreasury(other.address)
    ).to.be.revertedWith("Inedible: onlyDao");
    await factory.setTreasury(wallet.address);
    expect(await factory.treasury()).to.eq(wallet.address);
  });
  it("setFeeTo", async () => {
    const { factory, wallet, other } = await loadFixture(fixture);
    await expect(
      factory.connect(other).setFeeTo(other.address)
    ).to.be.revertedWith("Inedible: onlyDao");
    await factory.setFeeTo(wallet.address);
    expect(await factory.feeTo()).to.eq(wallet.address);
  });

  it("setLaunchFeePercent", async () => {
    const { factory, wallet, other } = await loadFixture(fixture);
    await expect(
      factory.connect(other).setLaunchFeePct(1000)
    ).to.be.revertedWith("Inedible: onlyDao");

    await expect(
      factory.connect(wallet).setLaunchFeePct(20000)
    ).to.be.revertedWith("Inedible: invalid launch fee");
    expect(await factory.minLaunchFeePct()).to.eq(DEFAULT_LAUNCH_FEE_PCT);

    const newLaunchFee = 1000; // 10%

    await factory.connect(wallet).setLaunchFeePct(newLaunchFee);
    expect(await factory.minLaunchFeePct()).to.eq(newLaunchFee);
  });
  it("setMinSupplyPct", async () => {
    const { factory, wallet, other } = await loadFixture(fixture);
    await expect(
      factory.connect(other).setMinSupplyPct(1000)
    ).to.be.revertedWith("Inedible: onlyDao");

    await expect(
      factory.connect(wallet).setMinSupplyPct(20000)
    ).to.be.revertedWith("Inedible: invalid min supply");

    expect(await factory.minSupplyPct()).to.eq(2500);

    const newMinSupplyPct = 6000; // 60%

    await factory.connect(wallet).setMinSupplyPct(newMinSupplyPct);
    expect(await factory.minSupplyPct()).to.eq(newMinSupplyPct);
  });

  it("transferOwnership", async () => {
    const { factory, wallet, other } = await loadFixture(fixture);
    expect(await factory.pendingDao()).to.equal(ethers.constants.AddressZero);
    await expect(
      factory.connect(other).transferOwnership(other.address)
    ).to.be.revertedWith("Inedible: onlyDao");

    await factory.connect(wallet).transferOwnership(other.address);
    expect(await factory.pendingDao()).to.equal(other.address);

    expect(await factory.dao()).to.equal(wallet.address);

    await factory.connect(other).acceptOwnership();

    expect(await factory.dao()).to.equal(other.address);
  });

  it("renounceOwnership", async () => {
    const { factory, wallet, other } = await loadFixture(fixture);
    await expect(factory.connect(other).renounceOwnership()).to.be.revertedWith(
      "Inedible: onlyDao"
    );

    await factory.connect(wallet).renounceOwnership();
    expect(await factory.dao()).to.equal(ethers.constants.AddressZero);
  });

  it("acceptOwnership", async () => {
    const { factory, wallet, other } = await loadFixture(fixture);
    await factory.connect(wallet).transferOwnership(other.address);

    expect(await factory.dao()).to.equal(wallet.address);

    await factory.connect(other).acceptOwnership();

    expect(await factory.dao()).to.equal(other.address);
  });
});

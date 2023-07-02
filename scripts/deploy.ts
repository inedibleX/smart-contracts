import "@nomicfoundation/hardhat-toolbox";
import hre, { ethers } from "hardhat";
import { InedibleXV1Factory, InedibleXV1Factory__factory } from "../src/types";

async function main() {
  const [deployer] = await ethers.getSigners();
  const bal = await deployer.getBalance();
  if (
    hre.network.name === "tenderly" &&
    bal.lt(ethers.utils.parseUnits("1", "ether"))
  ) {
    await hre.network.provider.send("tenderly_setBalance", [
      [deployer.address],
      ethers.utils.hexValue(
        ethers.utils.parseUnits("10", "ether").toHexString()
      ),
    ]);
  }

  const PairFactory = <InedibleXV1Factory__factory>(
    await ethers.getContractFactory("InedibleXV1Factory")
  );
  const pairFactory = <InedibleXV1Factory>(
    await PairFactory.deploy(deployer.address, deployer.address)
  );
  await pairFactory.deployed();
  console.log("Pair Factory deployed to address: ", pairFactory.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

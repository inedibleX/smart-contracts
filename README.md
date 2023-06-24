# inedibleX Smart Contracts
### <b> This code has traps built into it to avoid copycats before launch, do not use this code.</b>

inedibleX is a safe dex launchpad created as an Inedible Coin community project. We take the preferred method of fair launches today–opening a simple Uniswap pool–and add protections directly into the dex itself to protect users while maintaining the same experience.
<br><br>
In addition to these smart contracts, the frontend will have further protections such as blocking a user from purchasing a token if it detects they will not be able to sell it afterwards, and rating how well distributed a project’s tokens are.
<br><br>
The goal of the project is to find a middle ground between user safety and permissionless launching. In the future it’ll likely take on the form of a token being able to decide the protections it wants, then the frontend (fairly aggressively) filtering to automatically show only the safest pools, but still allow experienced users to see any others.
<br><br>
The MVP has the following features built into the smart contracts:
<br>
<br>1. <b>Sandwich Attack Protection</b>. The same protection as the original Inedible Coin, this will ensure only 2 transactions can happen in a single block. While this may sometimes result in innocent transactions failing, and the dex should not be used as an oracle if it has this protection, this is a built-in method to stop MEV bots from stealing user money.
<br><br>2. <b>Mandatory Liquidity Lock</b>. When creating a pool, the deployer must lock their liquidity tokens for at least 30 days. This is done upon initialization if the launch variable is true and enforced by requiring an address does not have a lock on their balance within the LP token’s _transfer function.
<br><br>3. <b>Mandatory Token Vesting</b>. When creating a pool, the deployer must vest their tokens for at least 30 days. This doesn’t work by locking up their tokens, but rather only allowing sells to occur on the dex if a buy by the same address preceded it. This means that any tokens that were not purchased on the dex may not be sold on it until after the vesting is over.
<br><br>4. <b>Launchpad Airdrops</b>. When creating a pool, at least 1% of the token supply must be airdropped to #INEDIBLE token holders. This primarily occurs through the Rewards.sol contract, in which an airdrop is saved to a certain timestamp, and the ERC20Votes format is used to determine what share of the airdrop a user is owed. This amount should be able to be increased as well if a coin wants extra marketing.
<br><br>5. <b>Withdrawable Fees</b>. Fees from providing LP should be able to be withdrawn separate from the tokens themselves. This includes withdrawing fees from locked LP tokens. This is done in sort of a weird way: we mint enough extra tokens in the _mintFee function to address(1) such that LP tokens never gain in value. We then use address(1) balance to track how much each holder is owed in a sort of SNX-style reward distribution scheme with cumulative fees, unclaimed amounts, and claiming. I don’t think this is the most efficient way, but it was one we felt comfortable with in the short timespan we had to code because it didn’t require changing any math.
<br><br>
We wanted to release this MVP with a quick turnaround, so we tried to make changes as simple and minimal as possible rather than as efficient as possible. We will be starting a bug bounty most likely around June 27th, but have some more tests to run on the code. We will then be launching with a limited amount of tokens to make sure the system is working without a huge amount of funds at risk.
<br><br>
For any comments or questions, please visit the Inedible Coin telegram at https://t.co/XY1vOfLseC. Thank you!

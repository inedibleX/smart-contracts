import dotenv from "dotenv";
dotenv.config();

export function getForkingBlockNumber(): number {
  if (process.env.BLOCK_NUMBER === undefined) {
    throw new Error("Please set block number to your .env file");
  }
  return parseInt(process.env.BLOCK_NUMBER);
}
export function getMainnetUrl(): string {
  if (process.env.MAINNET_URL_ALCHEMY === undefined) {
    throw new Error("Please set mainnet url in your .env");
  }
  return process.env.MAINNET_URL_ALCHEMY as string;
}

export function isMainnetFork(): boolean {
  return !!process.env.FORKING;
}

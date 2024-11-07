import {
  Web3Function,
  Web3FunctionContext,
} from "@gelatonetwork/web3-functions-sdk";
import { Contract } from "@ethersproject/contracts";
import ky from "ky"; // we recommend using ky as axios doesn't support fetch by default
import { CallWithERC2771Request, GelatoRelay } from "@gelatonetwork/relay-sdk";
import { ethers } from "ethers";

const ORACLE_ABI = [
  "function lastUpdated() external view returns(uint256)",
  "function updatePrice(uint256)",
];

Web3Function.onRun(async (context: Web3FunctionContext) => {
  const { userArgs, multiChainProvider } = context;

  const provider = multiChainProvider.default();
  const chainId = (await provider.getNetwork()).chainId;
  // Retrieve Last oracle update time
  const oracleAddress =
    (userArgs.oracle as string) ?? "0x59FA68250a6EBD6b89c7828AEec472DB3BaC0279";
  const userAddress =
    (userArgs.userAddress as string) ??
    "0xCf9cCB6d40d1293a764eF3A4A76ED68542339e4f";
  let lastUpdated;
  let oracle;
  try {
    oracle = new Contract(oracleAddress, ORACLE_ABI, provider);
    lastUpdated = parseInt(await oracle.lastUpdated());
    console.log(`Last oracle update: ${lastUpdated}`);
  } catch (err) {
    return { canExec: false, message: `Rpc call failed` };
  }

  // Check if it's ready for a new update
  const nextUpdateTime = lastUpdated + 3600; // 1h
  console.log(`Next oracle update: ${nextUpdateTime}`);

  // Get current price on coingecko
  const currency = (userArgs.currency as string) ?? "ethereum";
  let price = 0;
  try {
    const coingeckoApi = `https://api.coingecko.com/api/v3/simple/price?ids=${currency}&vs_currencies=usd`;

    const priceData: { [key: string]: { usd: number } } = await ky
      .get(coingeckoApi, { timeout: 5_000, retry: 0 })
      .json();
    price = Math.floor(priceData[currency].usd);

    const { data } = await oracle.populateTransaction.updatePrice(price);
    const request: CallWithERC2771Request = {
      chainId,
      target: oracleAddress,
      data: data as string,
      user: userAddress as string,
    };
    const relay = new GelatoRelay();
    const response = await relay.sponsoredCall(
      request,
      await context.secrets.get("API_KEY")
    );
    console.log(`https://relay.gelato.digital/tasks/status/${response.taskId}`);
  } catch (err) {
    return { canExec: false, message: err.message };
  }
  console.log(`Updating price: ${price}`);

  // Return execution call data
  return {
    canExec: true,
    callData: [],
  };
});

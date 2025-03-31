import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";
import "@nomicfoundation/hardhat-ethers";
import dotenv from "dotenv";

// 尝试加载.env文件
dotenv.config();

// 获取环境变量，如果不存在则使用默认值
const PRIVATE_KEY = process.env.PRIVATE_KEY || "0000000000000000000000000000000000000000000000000000000000000000";
const BSC_TESTNET_URL = process.env.BSC_TESTNET_URL || "https://data-seed-prebsc-1-s1.binance.org:8545/";
const BSC_MAINNET_URL = process.env.BSC_MAINNET_URL || "https://bsc-dataseed.binance.org/";

const config: HardhatUserConfig = {
  solidity: "0.8.28",
  networks: {
    // 本地开发网络
    hardhat: {
      chainId: 31337,
    },
    // BSC测试网
    bscTestnet: {
      url: BSC_TESTNET_URL,
      chainId: 97,
      accounts: [PRIVATE_KEY],
      gasPrice: 20000000000, // 20 Gwei
    },
    // BSC主网
    bscMainnet: {
      url: BSC_MAINNET_URL,
      chainId: 56,
      accounts: [PRIVATE_KEY],
      gasPrice: 5000000000, // 5 Gwei
    },
  },
  // Etherscan验证配置
  etherscan: {
    apiKey: {
      bscTestnet: process.env.BSCSCAN_API_KEY || "",
      bsc: process.env.BSCSCAN_API_KEY || "",
    },
  },
  // Gas报告设置
  gasReporter: {
    enabled: process.env.REPORT_GAS ? true : false,
    currency: "USD",
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
    token: "BNB",
  },
};

export default config;

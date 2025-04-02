import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";
import "@nomicfoundation/hardhat-ethers";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

// 尝试加载.env文件
dotenv.config();

// 获取环境变量，如果不存在则使用默认值
const PRIVATE_KEY = process.env.PRIVATE_KEY || "0000000000000000000000000000000000000000000000000000000000000000";
const BSC_TESTNET_URL = process.env.BSC_TESTNET_URL || "https://data-seed-prebsc-1-s1.binance.org:8545/";
const BSC_MAINNET_URL = process.env.BSC_MAINNET_URL || "https://bsc-dataseed.binance.org/";

// ABI extractor
const extractABI = async () => {
  const artifactsDir = path.join(__dirname, "artifacts/contracts");
  const abiDir = path.join(__dirname, "abi");

  // Create abi directory if it doesn't exist
  if (!fs.existsSync(abiDir)) {
    fs.mkdirSync(abiDir, { recursive: true });
  }

  const processDirectory = (directoryPath: string) => {
    const files = fs.readdirSync(directoryPath);

    files.forEach(file => {
      const filePath = path.join(directoryPath, file);
      const stats = fs.statSync(filePath);

      if (stats.isDirectory()) {
        processDirectory(filePath);
      } else if (file.endsWith('.json') && !file.endsWith('.dbg.json')) {
        try {
          const artifact = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          const contractName = path.basename(file, '.json');
          const relativePath = path.relative(artifactsDir, directoryPath);

          if (artifact.abi && artifact.abi.length > 0) {
            const abiFilePath = path.join(abiDir, `${relativePath.replace(/\//g, '_')}_${contractName}.json`);
            fs.writeFileSync(abiFilePath, JSON.stringify(artifact.abi, null, 2));
            console.log(`Generated ABI for ${contractName} at ${abiFilePath}`);
          }
        } catch (error) {
          console.error(`Error processing ${filePath}:`, error);
        }
      }
    });
  };

  if (fs.existsSync(artifactsDir)) {
    processDirectory(artifactsDir);
  } else {
    console.warn("Artifacts directory not found. Compile your contracts first.");
  }

  return Promise.resolve();
};

// Add extract-abi task
import { task } from "hardhat/config";
task("extract-abi", "Extracts ABI from compiled artifacts").setAction(extractABI);

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

// Auto-extract ABIs after compilation
import { TASK_COMPILE_SOLIDITY_COMPILE_JOBS } from "hardhat/builtin-tasks/task-names";
import { subtask } from "hardhat/config";

subtask(TASK_COMPILE_SOLIDITY_COMPILE_JOBS, "Automatically extract ABIs after compilation")
  .setAction(async (args, hre, runSuper) => {
    const result = await runSuper(args);
    await extractABI();
    return result;
  });

export default config;

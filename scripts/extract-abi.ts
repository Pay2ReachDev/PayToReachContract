import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";

async function main() {
    // This ensures the task is registered before we run it
    await import("../hardhat.config");

    // Get the Hardhat Runtime Environment
    const hre = require("hardhat") as HardhatRuntimeEnvironment;

    console.log("Extracting ABIs from compiled contracts...");
    await hre.run("extract-abi");
    console.log("ABI extraction completed!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Error during ABI extraction:", error);
        process.exit(1);
    }); 
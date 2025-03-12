// Script for deploying the Pay2Reach smart contract
// Usage: npx hardhat run scripts/deploy.js --network <network name>

const hre = require("hardhat");

async function main() {
    console.log("Starting deployment of Pay2Reach contract...");

    // Get the deployment account
    const [deployer] = await hre.ethers.getSigners();
    console.log(`Using account: ${deployer.address} for deployment`);

    // Display account balance before deployment
    const balance = await deployer.getBalance();
    console.log(`Deployment account balance: ${ethers.utils.formatEther(balance)} ETH`);

    // Deploy the contract
    const Pay2Reach = await hre.ethers.getContractFactory("Pay2Reach");
    const pay2Reach = await Pay2Reach.deploy();

    await pay2Reach.deployed();

    console.log(`Pay2Reach contract deployed to address: ${pay2Reach.address}`);
    console.log("Deployment completed!");

    // Instructions for contract verification
    console.log("\nContract verification command:");
    console.log(`npx hardhat verify --network ${hre.network.name} ${pay2Reach.address}`);

    return { pay2Reach };
}

// Run the deployment function
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Error during deployment process:");
        console.error(error);
        process.exit(1);
    }); 
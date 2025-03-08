// Script for deploying the KOL Messaging Platform smart contract
// Usage: npx hardhat run scripts/deploy.js --network <network name>

const hre = require("hardhat");

async function main() {
    console.log("Starting deployment of KOLMessaging contract...");

    // Get the deployment account
    const [deployer] = await hre.ethers.getSigners();
    console.log(`Using account: ${deployer.address} for deployment`);

    // Display account balance before deployment
    const balance = await deployer.getBalance();
    console.log(`Deployment account balance: ${ethers.utils.formatEther(balance)} ETH`);

    // Deploy the contract
    const KOLMessaging = await hre.ethers.getContractFactory("KOLMessaging");
    const kolMessaging = await KOLMessaging.deploy();

    await kolMessaging.deployed();

    console.log(`KOLMessaging contract deployed to address: ${kolMessaging.address}`);
    console.log("Deployment completed!");

    // Instructions for contract verification
    console.log("\nContract verification command:");
    console.log(`npx hardhat verify --network ${hre.network.name} ${kolMessaging.address}`);

    return { kolMessaging };
}

// Run the deployment function
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Error during deployment process:");
        console.error(error);
        process.exit(1);
    }); 
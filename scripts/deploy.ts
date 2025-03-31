import { createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";
import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function deployContract(name: string, constructorArgs: any[] = []) {
    console.log(`Deploying ${name}...`);

    let artifactPath;
    // Handle different facet locations
    if (name === "DiamondCutFacet" || name === "DiamondLoupeFacet" || name === "OwnershipFacet") {
        artifactPath = `../artifacts/contracts/diamond/facets/${name}.sol/${name}.json`;
    } else if (name === "Pay2ReachDiamond") {
        artifactPath = `../artifacts/contracts/Pay2ReachDiamond.sol/${name}.json`;
    } else if (name.startsWith("PayToReach") || name.startsWith("Pay2Reach")) {
        artifactPath = `../artifacts/contracts/diamond/facets/${name}.sol/${name}.json`;
    } else {
        artifactPath = `../artifacts/contracts/${name}.sol/${name}.json`;
    }

    console.log(`Using artifact path: ${artifactPath}`);

    try {
        const artifact = require(artifactPath);

        const publicClient = await hre.viem.getPublicClient();
        const [deployer] = await hre.viem.getWalletClients();

        console.log(`Deploying with account: ${deployer.account.address}`);

        const hash = await deployer.deployContract({
            abi: artifact.abi,
            bytecode: artifact.bytecode,
            args: constructorArgs,
        });

        console.log(`Transaction hash: ${hash}`);

        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        const address = receipt.contractAddress;

        if (!address) {
            throw new Error(`Failed to deploy ${name}`);
        }

        console.log(`${name} deployed to: ${address}`);
        return { address };
    } catch (err) {
        console.error(`Error deploying ${name}:`, err);
        throw err;
    }
}

async function main() {
    console.log("Deploying Pay2Reach Diamond Contract...");
    console.log("Network:", hre.network.name);

    // Get deployer address
    const [deployer] = await hre.viem.getWalletClients();
    const deployerAddress = deployer.account.address;
    console.log("Deployer address:", deployerAddress);

    // Deploy facets
    const { address: diamondCutFacetAddress } = await deployContract("DiamondCutFacet");
    const { address: diamondLoupeFacetAddress } = await deployContract("DiamondLoupeFacet");
    const { address: ownershipFacetAddress } = await deployContract("OwnershipFacet");
    const { address: payToReachManageFacetAddress } = await deployContract("PayToReachManageFacet");
    const { address: pay2ReachOrderFacetAddress } = await deployContract("Pay2ReachOrderFacet");
    const { address: pay2ReachPayFacetAddress } = await deployContract("Pay2ReachPayFacet");

    // Deploy Diamond with owner and DiamondCutFacet
    const { address: diamondAddress } = await deployContract("Pay2ReachDiamond", [
        deployerAddress,
        diamondCutFacetAddress
    ]);

    // Save deployment info
    const deploymentInfo = {
        network: hre.network.name,
        diamondAddress,
        facets: {
            DiamondCutFacet: diamondCutFacetAddress,
            DiamondLoupeFacet: diamondLoupeFacetAddress,
            OwnershipFacet: ownershipFacetAddress,
            PayToReachManageFacet: payToReachManageFacetAddress,
            Pay2ReachOrderFacet: pay2ReachOrderFacetAddress,
            Pay2ReachPayFacet: pay2ReachPayFacetAddress
        }
    };

    // Create deployments directory if it doesn't exist
    const deploymentDir = path.join(__dirname, "../deployments");
    if (!fs.existsSync(deploymentDir)) {
        fs.mkdirSync(deploymentDir);
    }

    // Save deployment info to file
    const deploymentFilePath = path.join(deploymentDir, `${hre.network.name}.json`);
    fs.writeFileSync(
        deploymentFilePath,
        JSON.stringify(deploymentInfo, null, 2)
    );

    console.log(`Deployment information saved to ${deploymentFilePath}`);
    console.log("Diamond Contract Deployment Complete!");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}); 
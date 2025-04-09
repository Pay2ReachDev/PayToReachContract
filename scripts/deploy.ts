import { createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";
import hre, { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { Interface } from "@ethersproject/abi";

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
    const { address: pay2ReachOrderFacetAddress } = await deployContract("Pay2ReachOrderFacet");
    const { address: pay2ReachPayFacetAddress } = await deployContract("Pay2ReachPayFacet");

    // Deploy Diamond with owner and DiamondCutFacet
    const { address: diamondAddress } = await deployContract("Pay2ReachDiamond", [
        deployerAddress,
        diamondCutFacetAddress
    ]);

    //add facets to the diamond
    const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };

    // Get function selectors from facet ABIs
    const getSelectorsFromABI = (contractName: string) => {
        let artifactPath;
        if (contractName === "DiamondCutFacet" || contractName === "DiamondLoupeFacet" || contractName === "OwnershipFacet") {
            artifactPath = path.join(__dirname, `../artifacts/contracts/diamond/facets/${contractName}.sol/${contractName}.json`);
        } else if (contractName.startsWith("PayToReach") || contractName.startsWith("Pay2Reach")) {
            artifactPath = path.join(__dirname, `../artifacts/contracts/diamond/facets/${contractName}.sol/${contractName}.json`);
        } else {
            artifactPath = path.join(__dirname, `../artifacts/contracts/${contractName}.sol/${contractName}.json`);
        }

        console.log(`Reading ABI from: ${artifactPath}`);
        const artifact = require(artifactPath);
        const abi = artifact.abi;

        // Get selectors from ABI
        const selectors: string[] = [];
        const iface = new Interface(abi);

        // Using a type assertion for Object.values
        const fragments: any[] = Object.values(iface.fragments);
        for (const fragment of fragments) {
            if (fragment.type === 'function' && fragment.name !== 'init') {
                try {
                    const selector = iface.getSighash(fragment);
                    selectors.push(selector);
                } catch (err) {
                    console.warn(`Error getting selector for ${fragment.name}:`, err);
                }
            }
        }

        return selectors;
    };

    let diamondLoupeSelectors: string[] = [];
    let ownershipSelectors: string[] = [];
    let pay2ReachOrderSelectors: string[] = [];
    let pay2ReachPaySelectors: string[] = [];

    try {
        diamondLoupeSelectors = getSelectorsFromABI("DiamondLoupeFacet");
        ownershipSelectors = getSelectorsFromABI("OwnershipFacet");
        pay2ReachOrderSelectors = getSelectorsFromABI("Pay2ReachOrderFacet");
        pay2ReachPaySelectors = getSelectorsFromABI("Pay2ReachPayFacet");

        console.log("DiamondLoupeFacet selectors:", diamondLoupeSelectors);
        console.log("OwnershipFacet selectors:", ownershipSelectors);
        console.log("Pay2ReachOrderFacet selectors:", pay2ReachOrderSelectors);
        console.log("Pay2ReachPayFacet selectors:", pay2ReachPaySelectors);
    } catch (error) {
        console.error("Error getting function selectors:", error);
    }

    // Create cut array for adding facets
    const cut = [
        {
            facetAddress: diamondLoupeFacetAddress,
            action: FacetCutAction.Add,
            functionSelectors: diamondLoupeSelectors
        },
        {
            facetAddress: ownershipFacetAddress,
            action: FacetCutAction.Add,
            functionSelectors: ownershipSelectors
        },
        {
            facetAddress: pay2ReachOrderFacetAddress,
            action: FacetCutAction.Add,
            functionSelectors: pay2ReachOrderSelectors
        },
        {
            facetAddress: pay2ReachPayFacetAddress,
            action: FacetCutAction.Add,
            functionSelectors: pay2ReachPaySelectors
        }
    ];

    console.log("Cutting diamond with facets...");
    const diamondCutFacet = await hre.ethers.getContractAt("DiamondCutFacet", diamondAddress);
    const tx = await diamondCutFacet.diamondCut(cut, "0x0000000000000000000000000000000000000000", "0x");
    const receipt = await tx.wait();
    if (!receipt.status) {
        throw Error(`Diamond cut failed: ${tx.hash}`);
    }
    console.log("Diamond cut complete!");

    // Save deployment info
    const deploymentInfo = {
        network: hre.network.name,
        diamondAddress,
        facets: {
            DiamondCutFacet: diamondCutFacetAddress,
            DiamondLoupeFacet: diamondLoupeFacetAddress,
            OwnershipFacet: ownershipFacetAddress,
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
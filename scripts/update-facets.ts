import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { ethers } from "hardhat";
import { FunctionFragment } from "ethers";

// FacetCutAction enum for clarity
enum FacetCutAction {
    Add = 0,
    Replace = 1,
    Remove = 2
}

// Helper function to get function selectors from a contract
async function getSelectors(contractName: string): Promise<string[]> {
    const factory = await ethers.getContractFactory(contractName);
    const fragments = factory.interface.fragments;

    // Extract function signatures from ABI and calculate selectors
    return fragments
        .filter(f => f.type === "function")
        .map(f => {
            const func = f as FunctionFragment;
            return factory.interface.getFunction(func.name)!.selector;
        });
}

async function deployContract(name: string, constructorArgs: any[] = []) {
    console.log(`Deploying ${name}...`);

    try {
        // Get the contract factory and deploy it
        const factory = await ethers.getContractFactory(name);
        const contract = await factory.deploy(...constructorArgs);

        // Wait for deployment transaction to be mined
        await contract.deploymentTransaction()?.wait(1);

        const address = await contract.getAddress();
        console.log(`${name} deployed to: ${address}`);

        // Verify the contract has code
        const provider = ethers.provider;
        const code = await provider.getCode(address);
        if (code === '0x' || code === '0x0') {
            throw new Error(`Contract deployment failed: no code at address ${address}`);
        }

        console.log(`Verified ${name} has code at ${address}`);
        return { address, contract };
    } catch (err) {
        console.error(`Error deploying ${name}:`, err);
        throw err;
    }
}

// Check if a function exists in the diamond
async function checkIfFunctionExists(diamondAddress: string, selector: string): Promise<boolean> {
    try {
        // DiamondLoupe interface for checking function existence
        const diamondLoupeInterface = new ethers.Interface([
            "function facetAddress(bytes4 _functionSelector) external view returns (address)"
        ]);

        // Call the DiamondLoupe facetAddress function
        const provider = ethers.provider;
        const result = await provider.call({
            to: diamondAddress,
            data: diamondLoupeInterface.encodeFunctionData("facetAddress", [selector])
        });

        const decodedResult = diamondLoupeInterface.decodeFunctionResult("facetAddress", result);
        const facetAddress = decodedResult[0];

        // If the address is not zero, the function exists
        return facetAddress !== ethers.ZeroAddress;
    } catch (error) {
        console.log(`Error checking if function exists: ${selector}`, error);
        return false;
    }
}

async function main() {
    // Get network from command line or use default
    const network = process.argv[2] || 'bscTestnet';
    console.log(`Updating facets on network: ${network}`);

    // Read deployment data
    const deploymentPath = path.join(__dirname, `../deployments/${network}.json`);
    if (!fs.existsSync(deploymentPath)) {
        console.error(`Deployment file not found at ${deploymentPath}`);
        return;
    }

    const deploymentData = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    const diamondAddress = deploymentData.diamondAddress;
    console.log(`Diamond address: ${diamondAddress}`);

    // Connect to the diamond with the DiamondCut interface only
    const diamondCut = await ethers.getContractAt("IDiamondCut", diamondAddress);

    // List of facets to update (excluding DiamondCutFacet to avoid breaking the upgrade mechanism)
    const facetsToUpdate = [
        "DiamondLoupeFacet",
        "OwnershipFacet",
        "PayToReachManageFacet",
        "Pay2ReachOrderFacet",
        "Pay2ReachPayFacet"
    ];

    // Track new deployments to update the deployment file
    const newFacets: Record<string, string> = {};

    // Try a safer approach - update one facet at a time
    for (const facetName of facetsToUpdate) {
        console.log(`Updating ${facetName}...`);

        // Deploy new version of the facet
        const { address: newFacetAddress, contract } = await deployContract(facetName);

        // Add additional verification by connecting to the contract
        try {
            await ethers.getContractAt(facetName, newFacetAddress);
            console.log(`Successfully connected to deployed ${facetName}`);
        } catch (error) {
            console.error(`Failed to connect to ${facetName} at ${newFacetAddress}`, error);
            throw new Error(`Verification failed for ${facetName}`);
        }

        newFacets[facetName] = newFacetAddress;

        // Get the selectors for the new facet
        const selectors = await getSelectors(facetName);
        console.log(`${facetName} has ${selectors.length} functions`);

        // Sort selectors into new and existing ones
        const existingSelectors: string[] = [];
        const newSelectors: string[] = [];

        // Check each selector
        for (const selector of selectors) {
            console.log(`Checking selector: ${selector}`);
            const exists = await checkIfFunctionExists(diamondAddress, selector);
            if (exists) {
                console.log(`Function exists: ${selector}`);
                existingSelectors.push(selector);
            } else {
                console.log(`Function is new: ${selector}`);
                newSelectors.push(selector);
            }
        }

        console.log(`Found ${existingSelectors.length} existing functions and ${newSelectors.length} new functions`);

        // Prepare the cut data for this facet
        const facetCut = [];

        // First remove existing functions if any
        if (existingSelectors.length > 0) {
            facetCut.push({
                facetAddress: ethers.ZeroAddress,
                action: FacetCutAction.Remove,
                functionSelectors: existingSelectors
            });
        }

        // Then add all functions (both existing and new)
        facetCut.push({
            facetAddress: newFacetAddress,
            action: FacetCutAction.Add,
            functionSelectors: selectors
        });

        // Update just this one facet
        if (facetCut.length > 0) {
            console.log(`Updating facet ${facetName}...`);
            console.log("Cut data:", JSON.stringify(facetCut, null, 2));

            try {
                const tx = await diamondCut.diamondCut(
                    facetCut,
                    "0x0000000000000000000000000000000000000000", // No initialization
                    "0x" // No calldata
                );
                console.log("Transaction hash:", tx.hash);

                const receipt = await tx.wait();
                console.log("Transaction confirmed in block:", receipt.blockNumber);
                console.log(`${facetName} updated successfully!`);
            } catch (error) {
                console.error(`Failed to update ${facetName}:`, error);
                // Continue with other facets even if this one fails
                continue;
            }
        }
    }

    // Update deployment file with new facet addresses
    for (const [facetName, address] of Object.entries(newFacets)) {
        deploymentData.facets[facetName] = address;
    }

    fs.writeFileSync(deploymentPath, JSON.stringify(deploymentData, null, 2));
    console.log("Deployment file updated with new facet addresses");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 
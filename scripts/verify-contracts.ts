import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

// Function to execute shell commands
function executeCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
        console.log(`Executing: ${command}`);
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error: ${error.message}`);
                if (stderr) console.error(`stderr: ${stderr}`);
                reject(error);
                return;
            }
            if (stderr) {
                console.error(`stderr: ${stderr}`);
            }
            resolve(stdout);
        });
    });
}

// Function to verify a contract
async function verifyContract(network: string, contractPath: string, contractName: string, address: string, args: string[] = []): Promise<void> {
    try {
        const argsString = args.length > 0 ? ` ${args.join(' ')}` : '';
        const command = `npx hardhat verify --network ${network} --contract ${contractPath}:${contractName} ${address}${argsString}`;

        const result = await executeCommand(command);
        console.log(`Verification result for ${contractName}:`);
        console.log(result);
        console.log('-'.repeat(80));
    } catch (error) {
        console.error(`Failed to verify ${contractName} at ${address}: ${error}`);
        console.log('-'.repeat(80));
    }
}

// Main function to verify all contracts
async function main() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.question('Enter network name (e.g., bscTestnet, bscMainnet): ', async (network) => {
        const deploymentPath = path.join(__dirname, `../deployments/${network}.json`);

        // Check if deployment file exists
        if (!fs.existsSync(deploymentPath)) {
            console.error(`Deployment file not found at ${deploymentPath}`);
            rl.close();
            return;
        }

        // Read deployment data
        const deploymentData = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
        console.log(`Found deployment data for ${network}`);
        console.log(`Diamond address: ${deploymentData.diamondAddress}`);
        console.log(`Number of facets: ${Object.keys(deploymentData.facets).length}`);
        console.log('-'.repeat(80));

        // Verify main diamond contract
        console.log('Verifying main Diamond contract...');
        await verifyContract(
            network,
            'contracts/Pay2ReachDiamond.sol',
            'Pay2ReachDiamond',
            deploymentData.diamondAddress,
            [deploymentData.owner || '0x4e351bce143f471c9f3947e2cb3ed529bd7a8a14', deploymentData.facets.DiamondCutFacet]
        );

        // Verify each facet
        for (const [facetName, facetAddress] of Object.entries(deploymentData.facets)) {
            console.log(`Verifying ${facetName}...`);

            let contractPath = '';
            if (facetName === 'DiamondCutFacet' || facetName === 'DiamondLoupeFacet' || facetName === 'OwnershipFacet') {
                contractPath = `contracts/diamond/facets/${facetName}.sol`;
            } else if (facetName.startsWith('PayToReach') || facetName.startsWith('Pay2Reach')) {
                contractPath = `contracts/diamond/facets/${facetName}.sol`;
            } else {
                contractPath = `contracts/${facetName}.sol`;
            }

            await verifyContract(network, contractPath, facetName, facetAddress as string);

            // Sleep for a short time between verifications to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        console.log('Contract verification complete!');
        rl.close();
    });
}

// Run the script
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}); 
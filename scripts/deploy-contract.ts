import { exec } from 'child_process';
import * as readline from 'readline';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function executeCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error: ${error.message}`);
                return reject(error);
            }
            if (stderr) {
                console.error(`stderr: ${stderr}`);
            }
            resolve(stdout);
        });
    });
}

async function deployToNetwork(network: string) {
    console.log(`\nDeploying contract to ${network}...`);

    try {
        // Compile contracts
        console.log("Compiling contracts...");
        await executeCommand("npx hardhat compile");

        // Deploy using the deploy script
        console.log(`Running deployment on ${network}...`);
        const result = await executeCommand(`npx hardhat run scripts/deploy.ts --network ${network}`);

        console.log("\nDeployment Results:");
        console.log(result);

        console.log(`\nContract successfully deployed to ${network}!`);
        console.log(`Check the deployments/${network}.json file for contract addresses.`);

        if (network !== "hardhat" && network !== "localhost") {
            console.log("\nTo verify the contract on BscScan, run:");
            console.log(`npx hardhat verify --network ${network} <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>`);
        }
    } catch (error) {
        console.error("Deployment failed:", error);
    }
}

async function main() {
    console.log("===== Pay2Reach Diamond Contract Deployment Tool =====");
    console.log("Available networks:");
    console.log("1. Local Hardhat Network (for testing)");
    console.log("2. BSC Testnet");
    console.log("3. BSC Mainnet");

    rl.question('\nSelect a network (1-3): ', async (answer) => {
        let network;

        switch (answer.trim()) {
            case '1':
                network = 'hardhat';
                break;
            case '2':
                network = 'bscTestnet';
                break;
            case '3':
                if (process.env.NODE_ENV !== 'production') {
                    console.log("\n⚠️ WARNING: You are about to deploy to BSC MAINNET ⚠️");
                    console.log("This will use real BNB for gas fees.");

                    rl.question('Are you sure you want to continue? (yes/no): ', async (confirmation) => {
                        if (confirmation.toLowerCase() === 'yes') {
                            await deployToNetwork('bscMainnet');
                        } else {
                            console.log("Mainnet deployment canceled.");
                        }
                        rl.close();
                    });
                    return;
                }
                network = 'bscMainnet';
                break;
            default:
                console.log("Invalid selection. Exiting.");
                rl.close();
                return;
        }

        if (network && answer.trim() !== '3') {
            await deployToNetwork(network);
            rl.close();
        }
    });
}

// Execute the script
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}); 
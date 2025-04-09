import { ethers } from 'ethers';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import axios from 'axios';

// Load environment variables
dotenv.config();

// Explorer API configuration
interface ExplorerConfig {
  apiUrl: string;
  apiKey?: string;
  browserUrl: string;
}

const EXPLORERS: Record<string, ExplorerConfig> = {
  bscTestnet: {
    apiUrl: 'https://api-testnet.bscscan.com/api',
    apiKey: process.env.BSCSCAN_API_KEY,
    browserUrl: 'https://testnet.bscscan.com'
  },
  bsc: {
    apiUrl: 'https://api.bscscan.com/api',
    apiKey: process.env.BSCSCAN_API_KEY,
    browserUrl: 'https://bscscan.com'
  },
  // Add more networks as needed
};

// Cache for contract name lookups to avoid repeated API calls
const contractNameCache: Record<string, string> = {};

// Function to get contract name from explorer API
async function getContractNameFromExplorer(address: string, network: string): Promise<string | null> {
  // Check cache first
  const cacheKey = `${network}:${address.toLowerCase()}`;
  if (contractNameCache[cacheKey]) {
    return contractNameCache[cacheKey];
  }

  // Get explorer config for the network
  const explorerConfig = EXPLORERS[network];
  if (!explorerConfig) {
    console.log(`No explorer configuration found for network ${network}`);
    return null;
  }

  // If no API key, can't make API calls
  if (!explorerConfig.apiKey) {
    console.log(`No API key found for ${network} explorer. Set ${network.toUpperCase()}_API_KEY in environment variables.`);
    return null;
  }

  try {
    // Make API call to get contract information
    const response = await axios.get(explorerConfig.apiUrl, {
      params: {
        module: 'contract',
        action: 'getsourcecode',
        address: address,
        apikey: explorerConfig.apiKey
      }
    });

    // Check if the API call was successful and returned data
    if (response.data && response.data.status === '1' && response.data.result && response.data.result.length > 0) {
      const contractInfo = response.data.result[0];

      // Get contract name from various sources
      let contractName = contractInfo.ContractName;

      // If empty, try to extract it from the implementation contract
      if (!contractName && contractInfo.Implementation) {
        console.log(`Contract at ${address} is a proxy. Checking implementation at ${contractInfo.Implementation}`);
        return getContractNameFromExplorer(contractInfo.Implementation, network);
      }

      // Check if we have ABI to determine if it's a facet
      if (contractInfo.ABI && contractInfo.ABI !== 'Contract source code not verified') {
        try {
          const abi = JSON.parse(contractInfo.ABI);
          // Check if any function names indicate it's a specific facet
          for (const item of abi) {
            if (item.type === 'function') {
              // If function name contains 'cut', it might be DiamondCutFacet
              if (item.name && item.name.toLowerCase().includes('cut')) {
                contractName = 'DiamondCutFacet';
                break;
              }
              // If function name is 'facets', it might be DiamondLoupeFacet
              if (item.name === 'facets') {
                contractName = 'DiamondLoupeFacet';
                break;
              }
            }
          }
        } catch (e) {
          // Ignore ABI parsing errors
        }
      }

      // If contract name was found, cache it
      if (contractName) {
        contractNameCache[cacheKey] = contractName;
        return contractName;
      }
    }

    return null;
  } catch (error: any) {
    console.error(`Error fetching contract information for ${address} on ${network}:`, error.message);
    return null;
  }
}

// Function to load and parse hardhat config
function loadHardhatConfig() {
  try {
    // Dynamically require hardhat config
    const configPath = path.resolve(__dirname, '../hardhat.config.ts');
    const configContent = fs.readFileSync(configPath, 'utf8');

    // Extract networks section using regex (simple approach)
    const networksMatch = configContent.match(/networks\s*:\s*{([^}]*)}[\s,]*\S+/s);
    if (!networksMatch) return null;

    const networksSection = networksMatch[1];

    // Parse network names and URLs
    const networks: Record<string, string> = {};

    // Add hardhat by default
    networks['hardhat'] = 'http://localhost:8545';

    // Find other networks - look for patterns like: networkName: { url: "..." }
    const networkRegex = /(\w+)\s*:\s*{[^}]*url\s*:\s*(?:['"]([^'"]+)['"]|(\w+)[,\s}])/g;
    let match;

    while ((match = networkRegex.exec(networksSection)) !== null) {
      const name = match[1];
      // If the URL is directly in the config, use it
      let url = match[2];

      // If URL is a variable name
      if (!url && match[3]) {
        const varName = match[3];
        // Find where the variable is defined in the config
        const varRegex = new RegExp(`const\\s+${varName}\\s*=\\s*(?:process\\.env\\.([\\w_]+)\\s*\\|\\|\\s*)?['"]([^'"]+)['"]`, 'g');
        const varMatch = varRegex.exec(configContent);

        if (varMatch) {
          const envVar = varMatch[1];
          const defaultUrl = varMatch[2];
          url = process.env[envVar] || defaultUrl;
        }
      }

      // Add to networks only if we found a URL
      if (url) {
        networks[name] = url;
      }
    }

    // Direct fallback for BSC Testnet if it's not found by regex
    if (!networks['bscTestnet'] && process.env.BSC_TESTNET_URL) {
      networks['bscTestnet'] = process.env.BSC_TESTNET_URL;
    } else if (!networks['bscTestnet']) {
      networks['bscTestnet'] = 'https://data-seed-prebsc-1-s1.binance.org:8545';
    }

    // Direct fallback for BSC Mainnet if it's not found by regex
    if (!networks['bsc'] && process.env.BSC_URL) {
      networks['bsc'] = process.env.BSC_URL;
    } else if (!networks['bsc']) {
      networks['bsc'] = 'https://bsc-dataseed.binance.org/';
    }
    return networks;
  } catch (error: any) {
    console.error('Error loading hardhat config:', error.message);
    // Always provide at least hardhat and bscTestnet as fallbacks
    return {
      hardhat: 'http://localhost:8545',
      bscTestnet: process.env.BSC_TESTNET_URL || 'https://data-seed-prebsc-1-s1.binance.org:8545',
      bsc: process.env.BSC_URL || 'https://bsc-dataseed.binance.org/'
    };
  }
}

// Function to load contract artifacts
function loadContractArtifacts() {
  const artifactsDir = path.resolve(__dirname, '../abi');
  const contractNames: Record<string, string> = {};
  const contractFunctions: Record<string, any[]> = {};

  try {
    // Read all files in the artifacts directory
    const files = fs.readdirSync(artifactsDir);

    for (const file of files) {
      if (file.endsWith('.json') && !fs.lstatSync(path.join(artifactsDir, file)).isDirectory()) {
        try {
          const artifactPath = path.join(artifactsDir, file);
          const artifactContent = fs.readFileSync(artifactPath, 'utf8');
          const artifact = JSON.parse(artifactContent);

          // Get contract name from file name (remove .json extension)
          const contractName = file.replace('.json', '');

          // Skip non-contract artifacts
          if (!Array.isArray(artifact)) {
            continue;
          }

          // Store functions for the contract
          contractFunctions[contractName] = artifact.filter(item => item.type === 'function');

          // For potential address lookup later
          if (contractName.includes('Facet')) {
            contractNames[contractName.toLowerCase()] = contractName;
          }
        } catch (error: any) {
          console.error(`Error processing artifact ${file}: ${error.message}`);
        }
      }
    }
    return { contractNames, contractFunctions };
  } catch (error: any) {
    console.error(`Error loading artifacts: ${error.message}`);
    return { contractNames: {}, contractFunctions: {} };
  }
}

// Function to find facet name by address from deployment info
async function findFacetNameByAddress(address: string, networks: string[]): Promise<string | null> {
  try {
    // First check in deployment files
    for (const network of networks) {
      const deploymentPath = path.join(__dirname, `../deployments/${network}.json`);
      if (fs.existsSync(deploymentPath)) {
        const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));

        // Search through the deployment info for the address
        for (const [key, value] of Object.entries(deploymentInfo)) {
          if (typeof value === 'string' && value.toLowerCase() === address.toLowerCase()) {
            return key;
          }
        }
      }
    }

    // If not found in deployments, try explorer API
    for (const network of networks) {
      if (EXPLORERS[network]) {
        const name = await getContractNameFromExplorer(address, network);
        if (name) {
          return name;
        }
      }
    }

    return null;
  } catch (error) {
    return null;
  }
}

// Function to get function name by selector
function getFunctionNameBySelector(selector: string, contractFunctions: Record<string, any[]>): string {
  for (const [contractName, functions] of Object.entries(contractFunctions)) {
    for (const func of functions) {
      try {
        if (func.name) {
          // Calculate function selector from signature
          const signature = `${func.name}(${func.inputs.map((input: any) => input.type).join(',')})`;
          const functionSelector = ethers.id(signature).substring(0, 10);

          if (functionSelector.toLowerCase() === selector.toLowerCase()) {
            // Return function signature
            return `${func.name}(${func.inputs.map((input: any) => input.type).join(',')})`;
          }
        }
      } catch (error) {
        // Skip if we can't calculate selector
        continue;
      }
    }
  }
  return 'Unknown Function';
}

// Function to export facet data to file
async function exportFacetsToFile(diamondAddress: string, facets: any[], selectedNetwork: string, contractFunctions: Record<string, any[]>) {
  try {
    // Create a directory for exports if it doesn't exist
    const exportDir = path.join(__dirname, '../exports');
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir);
    }

    // Get facet names asynchronously
    const facetNames = await Promise.all(
      facets.map(facet => findFacetNameByAddress(facet.facetAddress, [selectedNetwork]))
    );

    // Prepare export data
    const exportData = {
      diamondAddress,
      network: selectedNetwork,
      exportTime: new Date().toISOString(),
      facetsCount: facets.length,
      facets: facets.map((facet, index) => {
        const facetAddress = facet.facetAddress;
        const facetName = facetNames[index] || 'Unknown Facet';

        return {
          index: index + 1,
          name: facetName,
          address: facetAddress,
          functionCount: facet.functionSelectors.length,
          functions: facet.functionSelectors.map((selector: string) => {
            return {
              selector,
              name: getFunctionNameBySelector(selector, contractFunctions)
            };
          })
        };
      })
    };

    // Write to file
    const fileName = `diamond-${diamondAddress.substring(0, 8)}-${selectedNetwork}-${Date.now()}.json`;
    const filePath = path.join(exportDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2));

    return filePath;
  } catch (error: any) {
    console.error('Failed to export facet data:', error.message);
    return null;
  }
}

// Define DiamondCut facet ABI
const DIAMOND_CUT_ABI = [
  'function diamondCut((address facetAddress, uint8 action, bytes4[] functionSelectors)[] _diamondCut, address _init, bytes _calldata) external'
];

// Enum for facet cut actions
enum FacetCutAction {
  Add = 0,
  Replace = 1,
  Remove = 2
}

// Process a Diamond contract
async function processDiamondContract(diamondAddress: string, provider: ethers.JsonRpcProvider, selectedNetwork: string, rl: readline.Interface, contractFunctions: Record<string, any[]>) {
  try {
    // Check if contract implements Diamond interface
    const contract = new ethers.Contract(
      diamondAddress,
      [
        // DiamondLoupe interface
        'function facets() external view returns (tuple(address facetAddress, bytes4[] functionSelectors)[])'
      ],
      provider
    );

    // Try to call the facets() function
    const facets = await contract.facets();

    console.log('\n✅ This is a Diamond contract!');
    console.log('\nFacets:');
    console.log('-----------------------');

    // Display all facets
    for (let i = 0; i < facets.length; i++) {
      const facet = facets[i];
      const facetAddress = facet.facetAddress;

      // Try to find facet name from deployments and explorer
      let facetName = await findFacetNameByAddress(facetAddress, [selectedNetwork]) || 'Unknown Facet';

      console.log(`${i + 1}. ${facetName} (${facetAddress})`);
      console.log(`   Function selectors (${facet.functionSelectors.length}):`);

      // Only show first 3 selectors if there are many
      const selectorsToShow = facet.functionSelectors.slice(0, 3);
      selectorsToShow.forEach((selector: string) => {
        const functionName = getFunctionNameBySelector(selector, contractFunctions);
        console.log(`   - ${selector} => ${functionName}`);
      });

      if (facet.functionSelectors.length > 3) {
        console.log(`   ... and ${facet.functionSelectors.length - 3} more selectors`);
      }

      console.log('-----------------------');
    }

    console.log(`\nTotal facets: ${facets.length}`);

    // Check if DiamondCutFacet is available
    const facetNames = await Promise.all(
      facets.map((facet: any) => findFacetNameByAddress(facet.facetAddress, [selectedNetwork]))
    );

    const diamondCutFacetIndex = facetNames.findIndex(name => name === 'DiamondCutFacet');
    const hasDiamondCutFacet = diamondCutFacetIndex !== -1;

    // Ask user if they want to view or modify a facet
    console.log('\nOptions:');
    console.log('1. View detailed information for a specific facet');
    if (hasDiamondCutFacet) {
      console.log('2. Modify facets (add/remove functions) - Requires private key with owner access');
    }
    console.log('3. Export all facet information to file');
    console.log('0. Exit');

    const actionPrompt = new Promise<string>((resolve) => {
      rl.question('\nSelect an option: ', resolve);
    });

    const action = await actionPrompt;

    if (action === '0') {
      console.log('Exiting...');
      rl.close();
      return;
    } else if (action === '1') {
      // View detailed information for a specific facet
      const facetPrompt = new Promise<string>((resolve) => {
        rl.question('\nEnter facet number to view details: ', resolve);
      });

      const facetNum = await facetPrompt;
      const facetIndex = parseInt(facetNum) - 1;

      if (isNaN(facetIndex) || facetIndex < 0 || facetIndex >= facets.length) {
        console.error('Invalid facet number.');
        await processDiamondContract(diamondAddress, provider, selectedNetwork, rl, contractFunctions);
        return;
      }

      const selectedFacet = facets[facetIndex];
      const facetName = await findFacetNameByAddress(selectedFacet.facetAddress, [selectedNetwork]) || 'Unknown Facet';

      console.log(`\nDetailed information for facet: ${facetName}`);
      console.log(`Address: ${selectedFacet.facetAddress}`);
      console.log(`Total functions: ${selectedFacet.functionSelectors.length}`);
      console.log('\nFunction selectors:');

      selectedFacet.functionSelectors.forEach((selector: string, idx: number) => {
        const functionName = getFunctionNameBySelector(selector, contractFunctions);
        console.log(`${idx + 1}. ${selector} => ${functionName}`);
      });

      // Return to main menu
      await processDiamondContract(diamondAddress, provider, selectedNetwork, rl, contractFunctions);
      return;
    } else if (action === '2' && hasDiamondCutFacet) {
      // Try to get private key from environment variables first
      let privateKey = process.env.PRIVATE_KEY;

      // If not found in environment, prompt the user
      if (!privateKey) {
        console.log('\nPrivate key not found in environment variables.');
        const privateKeyPrompt = new Promise<string>((resolve) => {
          rl.question('\nEnter private key (or press Enter to cancel): ', resolve);
        });

        privateKey = await privateKeyPrompt;
      } else {
        console.log('\nUsing private key from environment variables.');
      }

      if (!privateKey) {
        console.log('Operation cancelled.');
        await processDiamondContract(diamondAddress, provider, selectedNetwork, rl, contractFunctions);
        return;
      }

      try {
        // Create wallet from private key
        const wallet = new ethers.Wallet(privateKey, provider);

        console.log('\nFacet modification options:');
        console.log('1. Remove all functions from a facet');
        console.log('2. Remove specific functions from a facet');
        console.log('3. Update facet implementation (replace with new address)');
        console.log('4. Deploy new facet implementation');
        console.log('0. Cancel');

        const modifyPrompt = new Promise<string>((resolve) => {
          rl.question('\nSelect an option: ', resolve);
        });

        const modifyOption = await modifyPrompt;

        if (modifyOption === '0') {
          console.log('Operation cancelled.');
          await processDiamondContract(diamondAddress, provider, selectedNetwork, rl, contractFunctions);
          return;
        } else if (modifyOption === '1' || modifyOption === '2') {
          // Select facet to modify
          const facetPrompt = new Promise<string>((resolve) => {
            rl.question('\nEnter facet number to modify: ', resolve);
          });

          const facetNum = await facetPrompt;
          const facetIndex = parseInt(facetNum) - 1;

          if (isNaN(facetIndex) || facetIndex < 0 || facetIndex >= facets.length) {
            console.error('Invalid facet number.');
            await processDiamondContract(diamondAddress, provider, selectedNetwork, rl, contractFunctions);
            return;
          }

          const selectedFacet = facets[facetIndex];
          const facetName = await findFacetNameByAddress(selectedFacet.facetAddress, [selectedNetwork]) || 'Unknown Facet';

          if (modifyOption === '1') {
            // Remove all functions
            console.log(`\nRemoving all functions from facet: ${facetName}`);
            console.log('Are you sure? This operation cannot be undone.');

            const confirmPrompt = new Promise<string>((resolve) => {
              rl.question('Type "CONFIRM" to proceed: ', resolve);
            });

            const confirm = await confirmPrompt;

            if (confirm === 'CONFIRM') {
              // Create properly formatted selectors array (as bytes4 format)
              const formattedSelectors = selectedFacet.functionSelectors.map((selector: string) => selector);

              console.log(`Removing ${formattedSelectors.length} functions from ${facetName}...`);

              // Prepare the diamond cut data
              const diamondCut = [
                {
                  facetAddress: ethers.ZeroAddress,
                  action: FacetCutAction.Remove,
                  functionSelectors: formattedSelectors
                }
              ];

              // Connect to the DiamondCut contract
              const diamondCutter = new ethers.Contract(
                diamondAddress,
                DIAMOND_CUT_ABI,
                wallet
              );

              console.log('\nSending transaction to remove all functions...');
              try {
                // Log the transaction parameters for debugging
                console.log('Transaction parameters:');
                console.log('- Zero Address:', ethers.ZeroAddress);
                console.log('- Action:', FacetCutAction.Remove);
                console.log('- First selector:', formattedSelectors[0]);

                const tx = await diamondCutter.diamondCut(
                  diamondCut,
                  ethers.ZeroAddress,
                  '0x'
                );

                console.log(`Transaction sent: ${tx.hash}`);
                console.log('Waiting for confirmation...');

                await tx.wait();
                console.log('✅ Functions successfully removed!');
              } catch (error: any) {
                console.error('❌ Failed to remove functions:', error.message);
                if (error.info) {
                  console.error('Error info:', error.info);
                }
                if (error.code) {
                  console.error('Error code:', error.code);
                }
              }
            } else {
              console.log('Operation cancelled.');
            }
          } else if (modifyOption === '2') {
            // Remove specific functions
            console.log(`\nSelect functions to remove from facet: ${facetName}`);

            selectedFacet.functionSelectors.forEach((selector: string, idx: number) => {
              const functionName = getFunctionNameBySelector(selector, contractFunctions);
              console.log(`${idx + 1}. ${selector} => ${functionName}`);
            });

            const selectorPrompt = new Promise<string>((resolve) => {
              rl.question('\nEnter function numbers to remove (comma-separated, e.g. 1,3,5): ', resolve);
            });

            const selectorInput = await selectorPrompt;
            const selectorIndices = selectorInput.split(',').map(num => parseInt(num.trim()) - 1);

            // Validate indices
            const validIndices = selectorIndices.filter(idx => !isNaN(idx) && idx >= 0 && idx < selectedFacet.functionSelectors.length);

            if (validIndices.length === 0) {
              console.error('No valid function numbers provided.');
              await processDiamondContract(diamondAddress, provider, selectedNetwork, rl, contractFunctions);
              return;
            }

            // Get the selectors to remove
            const selectorsToRemove = validIndices.map(idx => selectedFacet.functionSelectors[idx]);

            console.log(`\nRemoving ${selectorsToRemove.length} functions from facet: ${facetName}`);
            console.log('Are you sure? This operation cannot be undone.');

            const confirmPrompt = new Promise<string>((resolve) => {
              rl.question('Type "CONFIRM" to proceed: ', resolve);
            });

            const confirm = await confirmPrompt;

            if (confirm === 'CONFIRM') {
              // Create properly formatted selectors array
              const formattedSelectors = selectorsToRemove.map((selector: string) => selector);

              console.log(`Removing ${formattedSelectors.length} functions from ${facetName}...`);

              // Prepare the diamond cut data
              const diamondCut = [
                {
                  facetAddress: ethers.ZeroAddress,
                  action: FacetCutAction.Remove,
                  functionSelectors: formattedSelectors
                }
              ];

              // Connect to the DiamondCut contract
              const diamondCutter = new ethers.Contract(
                diamondAddress,
                DIAMOND_CUT_ABI,
                wallet
              );

              console.log('\nSending transaction to remove functions...');
              try {
                // Log the transaction parameters for debugging
                console.log('Transaction parameters:');
                console.log('- Zero Address:', ethers.ZeroAddress);
                console.log('- Action:', FacetCutAction.Remove);
                console.log('- First selector:', formattedSelectors[0]);

                const tx = await diamondCutter.diamondCut(
                  diamondCut,
                  ethers.ZeroAddress,
                  '0x'
                );

                console.log(`Transaction sent: ${tx.hash}`);
                console.log('Waiting for confirmation...');

                await tx.wait();
                console.log('✅ Functions successfully removed!');
              } catch (error: any) {
                console.error('❌ Failed to remove functions:', error.message);
                if (error.info) {
                  console.error('Error info:', error.info);
                }
                if (error.code) {
                  console.error('Error code:', error.code);
                }
              }
            } else {
              console.log('Operation cancelled.');
            }
          }
        } else if (modifyOption === '3') {
          // Update facet implementation
          const facetPrompt = new Promise<string>((resolve) => {
            rl.question('\nEnter facet number to update: ', resolve);
          });

          const facetNum = await facetPrompt;
          const facetIndex = parseInt(facetNum) - 1;

          if (isNaN(facetIndex) || facetIndex < 0 || facetIndex >= facets.length) {
            console.error('Invalid facet number.');
            await processDiamondContract(diamondAddress, provider, selectedNetwork, rl, contractFunctions);
            return;
          }

          const selectedFacet = facets[facetIndex];
          const facetName = await findFacetNameByAddress(selectedFacet.facetAddress, [selectedNetwork]) || 'Unknown Facet';

          console.log(`\nUpdating facet: ${facetName}`);
          console.log(`Current implementation address: ${selectedFacet.facetAddress}`);
          console.log(`Function selectors count: ${selectedFacet.functionSelectors.length}`);

          // Prompt for new implementation address
          const newAddressPrompt = new Promise<string>((resolve) => {
            rl.question('\nEnter new implementation address: ', resolve);
          });

          const newAddress = await newAddressPrompt;

          // Validate the new address
          if (!ethers.isAddress(newAddress)) {
            console.error('Invalid Ethereum address format.');
            await processDiamondContract(diamondAddress, provider, selectedNetwork, rl, contractFunctions);
            return;
          }

          console.log(`\nReady to update ${facetName} from ${selectedFacet.facetAddress} to ${newAddress}`);
          console.log('Are you sure? This operation cannot be undone.');

          const confirmPrompt = new Promise<string>((resolve) => {
            rl.question('Type "CONFIRM" to proceed: ', resolve);
          });

          const confirm = await confirmPrompt;

          if (confirm === 'CONFIRM') {
            console.log(`\nUpdating facet ${facetName}...`);

            // Format selectors for the diamondCut call
            const formattedSelectors = selectedFacet.functionSelectors.map((selector: string) => selector);

            // Prepare the diamond cut data with Replace action
            const diamondCut = [
              {
                facetAddress: newAddress,
                action: FacetCutAction.Replace,
                functionSelectors: formattedSelectors
              }
            ];

            // Connect to the DiamondCut contract
            const diamondCutter = new ethers.Contract(
              diamondAddress,
              DIAMOND_CUT_ABI,
              wallet
            );

            console.log('\nSending transaction to update facet...');
            try {
              // Log the transaction parameters for debugging
              console.log('Transaction parameters:');
              console.log('- New facet address:', newAddress);
              console.log('- Action:', FacetCutAction.Replace);
              console.log('- Function selectors count:', formattedSelectors.length);

              const tx = await diamondCutter.diamondCut(
                diamondCut,
                ethers.ZeroAddress,
                '0x'
              );

              console.log(`Transaction sent: ${tx.hash}`);
              console.log('Waiting for confirmation...');

              await tx.wait();
              console.log('✅ Facet successfully updated!');
            } catch (error: any) {
              console.error('❌ Failed to update facet:', error.message);
              if (error.info) {
                console.error('Error info:', error.info);
              }
              if (error.code) {
                console.error('Error code:', error.code);
              }
            }
          } else {
            console.log('Operation cancelled.');
          }
        } else if (modifyOption === '4') {
          // Auto-deploy new facet implementation
          console.log('\nDeploying new facet implementation');

          // Ask for facet name
          const facetNamePrompt = new Promise<string>((resolve) => {
            rl.question('\nEnter the facet name (e.g. DiamondCutFacet): ', resolve);
          });
          const facetName = await facetNamePrompt;

          if (!facetName) {
            console.error('Invalid facet name.');
            await processDiamondContract(diamondAddress, provider, selectedNetwork, rl, contractFunctions);
            return;
          }

          try {
            // Try to find artifact for the facet
            const artifactsDir = path.resolve(__dirname, '../artifacts');
            const contractDir = path.resolve(artifactsDir, 'contracts');

            // Array to store all the found artifact paths
            const foundArtifacts: string[] = [];

            // Function to recursively search for contract artifacts
            function findArtifacts(dir: string) {
              if (!fs.existsSync(dir)) return;

              const files = fs.readdirSync(dir);

              for (const file of files) {
                const fullPath = path.join(dir, file);

                if (fs.lstatSync(fullPath).isDirectory()) {
                  findArtifacts(fullPath);
                } else if (file.endsWith('.json') && !file.endsWith('.dbg.json')) {
                  try {
                    const artifactContent = fs.readFileSync(fullPath, 'utf8');
                    const artifact = JSON.parse(artifactContent);

                    // Check if this is a contract artifact with the desired name
                    if (artifact.contractName &&
                      artifact.contractName.toLowerCase() === facetName.toLowerCase()) {
                      foundArtifacts.push(fullPath);
                    }
                  } catch (e) {
                    // Skip files that can't be parsed
                  }
                }
              }
            }

            // Start the search
            findArtifacts(contractDir);

            if (foundArtifacts.length === 0) {
              console.error(`No artifacts found for facet ${facetName}. Make sure it's compiled.`);
              await processDiamondContract(diamondAddress, provider, selectedNetwork, rl, contractFunctions);
              return;
            }

            console.log(`\nFound ${foundArtifacts.length} artifact(s) for ${facetName}:`);
            foundArtifacts.forEach((path, idx) => {
              console.log(`${idx + 1}. ${path}`);
            });

            // If multiple artifacts found, ask user to choose one
            let artifactPath = foundArtifacts[0];

            if (foundArtifacts.length > 1) {
              const artifactPrompt = new Promise<string>((resolve) => {
                rl.question('\nMultiple artifacts found. Select one (enter number): ', resolve);
              });

              const artifactNum = await artifactPrompt;
              const artifactIndex = parseInt(artifactNum) - 1;

              if (isNaN(artifactIndex) || artifactIndex < 0 || artifactIndex >= foundArtifacts.length) {
                console.error('Invalid selection.');
                await processDiamondContract(diamondAddress, provider, selectedNetwork, rl, contractFunctions);
                return;
              }

              artifactPath = foundArtifacts[artifactIndex];
            }

            // Load the selected artifact
            console.log(`\nLoading artifact from ${artifactPath}...`);
            const artifactContent = fs.readFileSync(artifactPath, 'utf8');
            const artifact = JSON.parse(artifactContent);

            if (!artifact.abi || !artifact.bytecode) {
              console.error('Invalid artifact: missing ABI or bytecode.');
              await processDiamondContract(diamondAddress, provider, selectedNetwork, rl, contractFunctions);
              return;
            }

            console.log('Artifact loaded successfully.');

            // Check if the contract has a constructor with parameters
            const constructorAbi = artifact.abi.find((item: any) => item.type === 'constructor');
            const hasConstructorParams = constructorAbi && constructorAbi.inputs && constructorAbi.inputs.length > 0;

            let constructorArgs: any[] = [];

            if (hasConstructorParams) {
              console.log('\nThis contract has constructor parameters:');
              constructorAbi.inputs.forEach((input: any, idx: number) => {
                console.log(`${idx + 1}. ${input.name} (${input.type})`);
              });

              const argsPrompt = new Promise<string>((resolve) => {
                rl.question('\nEnter constructor arguments as JSON array (e.g. ["0x123...", 100]): ', resolve);
              });

              const argsStr = await argsPrompt;

              try {
                constructorArgs = JSON.parse(argsStr);

                if (!Array.isArray(constructorArgs)) {
                  throw new Error('Arguments must be in array format');
                }

                if (constructorArgs.length !== constructorAbi.inputs.length) {
                  throw new Error(`Expected ${constructorAbi.inputs.length} arguments, got ${constructorArgs.length}`);
                }
              } catch (e: any) {
                console.error(`Invalid constructor arguments: ${e.message}`);
                await processDiamondContract(diamondAddress, provider, selectedNetwork, rl, contractFunctions);
                return;
              }
            }

            // Confirm deployment
            console.log(`\nReady to deploy ${facetName} to ${selectedNetwork}`);

            const confirmPrompt = new Promise<string>((resolve) => {
              rl.question('Type "CONFIRM" to proceed: ', resolve);
            });

            const confirm = await confirmPrompt;

            if (confirm !== 'CONFIRM') {
              console.log('Deployment cancelled.');
              await processDiamondContract(diamondAddress, provider, selectedNetwork, rl, contractFunctions);
              return;
            }

            console.log('\nDeploying contract...');

            // Create contract factory
            const factory = new ethers.ContractFactory(
              artifact.abi,
              artifact.bytecode,
              wallet
            );

            // Deploy the contract
            const contract = await factory.deploy(...constructorArgs);

            console.log(`Contract deployment transaction sent: ${contract.deploymentTransaction()?.hash}`);
            console.log('Waiting for confirmation...');

            await contract.waitForDeployment();

            const deployedAddress = await contract.getAddress();
            console.log(`\n✅ Contract deployed successfully at: ${deployedAddress}`);

            // Ask if the user wants to use this address to update an existing facet
            const updatePrompt = new Promise<string>((resolve) => {
              rl.question('\nDo you want to update an existing facet with this new implementation? (y/n): ', resolve);
            });

            const updateResponse = await updatePrompt;

            if (updateResponse.toLowerCase() === 'y' || updateResponse.toLowerCase() === 'yes') {
              // Display all facets for selection
              console.log('\nSelect the facet to update:');

              for (let i = 0; i < facets.length; i++) {
                const facet = facets[i];
                const facetAddress = facet.facetAddress;
                const facetName = await findFacetNameByAddress(facetAddress, [selectedNetwork]) || 'Unknown Facet';

                console.log(`${i + 1}. ${facetName} (${facetAddress})`);
                console.log(`   Function selectors: ${facet.functionSelectors.length}`);
              }

              const facetPrompt = new Promise<string>((resolve) => {
                rl.question('\nEnter facet number to update: ', resolve);
              });

              const facetNum = await facetPrompt;
              const facetIndex = parseInt(facetNum) - 1;

              if (isNaN(facetIndex) || facetIndex < 0 || facetIndex >= facets.length) {
                console.error('Invalid facet number.');
                await processDiamondContract(diamondAddress, provider, selectedNetwork, rl, contractFunctions);
                return;
              }

              const selectedFacet = facets[facetIndex];
              const selectedFacetName = await findFacetNameByAddress(selectedFacet.facetAddress, [selectedNetwork]) || 'Unknown Facet';

              console.log(`\nUpdating facet: ${selectedFacetName}`);
              console.log(`Current implementation address: ${selectedFacet.facetAddress}`);
              console.log(`New implementation address: ${deployedAddress}`);
              console.log(`Function selectors count: ${selectedFacet.functionSelectors.length}`);

              console.log('\nAre you sure you want to update this facet?');

              const confirmUpdatePrompt = new Promise<string>((resolve) => {
                rl.question('Type "CONFIRM" to proceed: ', resolve);
              });

              const confirmUpdate = await confirmUpdatePrompt;

              if (confirmUpdate === 'CONFIRM') {
                // Format selectors for the diamondCut call
                const formattedSelectors = selectedFacet.functionSelectors.map((selector: string) => selector);

                // Prepare the diamond cut data with Replace action
                const diamondCut = [
                  {
                    facetAddress: deployedAddress,
                    action: FacetCutAction.Replace,
                    functionSelectors: formattedSelectors
                  }
                ];

                // Connect to the DiamondCut contract
                const diamondCutter = new ethers.Contract(
                  diamondAddress,
                  DIAMOND_CUT_ABI,
                  wallet
                );

                console.log('\nSending transaction to update facet...');
                try {
                  // Log the transaction parameters for debugging
                  console.log('Transaction parameters:');
                  console.log('- New facet address:', deployedAddress);
                  console.log('- Action:', FacetCutAction.Replace);
                  console.log('- Function selectors count:', formattedSelectors.length);

                  const tx = await diamondCutter.diamondCut(
                    diamondCut,
                    ethers.ZeroAddress,
                    '0x'
                  );

                  console.log(`Transaction sent: ${tx.hash}`);
                  console.log('Waiting for confirmation...');

                  await tx.wait();
                  console.log('✅ Facet successfully updated!');

                  // Update deployment file if it exists
                  try {
                    const deploymentPath = path.join(__dirname, `../deployments/${selectedNetwork}.json`);
                    if (fs.existsSync(deploymentPath)) {
                      const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));

                      // Update the address if the facet name exists in deployment
                      let updated = false;
                      for (const [key, value] of Object.entries(deploymentInfo)) {
                        if (key === selectedFacetName) {
                          deploymentInfo[key] = deployedAddress;
                          updated = true;
                          break;
                        }
                      }

                      // Add the new facet if it doesn't exist
                      if (!updated) {
                        deploymentInfo[facetName] = deployedAddress;
                      }

                      fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
                      console.log(`✅ Updated deployment file at ${deploymentPath}`);
                    }
                  } catch (error: any) {
                    console.error(`Note: Could not update deployment file: ${error.message}`);
                  }
                } catch (error: any) {
                  console.error('❌ Failed to update facet:', error.message);
                  if (error.info) {
                    console.error('Error info:', error.info);
                  }
                  if (error.code) {
                    console.error('Error code:', error.code);
                  }
                }
              } else {
                console.log('Update operation cancelled.');
              }
            } else {
              console.log('Facet deployed but not connected to the Diamond.');

              // Update deployment file if it exists
              try {
                const deploymentPath = path.join(__dirname, `../deployments/${selectedNetwork}.json`);
                if (fs.existsSync(deploymentPath)) {
                  const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));

                  // Add the new facet
                  deploymentInfo[facetName] = deployedAddress;

                  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
                  console.log(`✅ Updated deployment file at ${deploymentPath}`);
                }
              } catch (error: any) {
                console.error(`Note: Could not update deployment file: ${error.message}`);
              }
            }
          } catch (error: any) {
            console.error('❌ Error during deployment:', error.message);
            if (error.info) {
              console.error('Error info:', error.info);
            }
            if (error.code) {
              console.error('Error code:', error.code);
            }
          }
        }

        // Return to main menu
        await processDiamondContract(diamondAddress, provider, selectedNetwork, rl, contractFunctions);
        return;
      } catch (error: any) {
        console.error('Error with private key or transaction:', error.message);
        await processDiamondContract(diamondAddress, provider, selectedNetwork, rl, contractFunctions);
        return;
      }
    } else if (action === '3') {
      console.log('\nExporting all facet information to file...');
      const exportPath = await exportFacetsToFile(diamondAddress, facets, selectedNetwork, contractFunctions);
      if (exportPath) {
        console.log(`✅ Facet information exported to: ${exportPath}`);
      } else {
        console.error('❌ Failed to export facet information.');
      }

      // Return to main menu
      await processDiamondContract(diamondAddress, provider, selectedNetwork, rl, contractFunctions);
      return;
    } else {
      console.error('Invalid option.');
      await processDiamondContract(diamondAddress, provider, selectedNetwork, rl, contractFunctions);
      return;
    }
  } catch (error: any) {
    console.error('\n❌ This contract does not implement the Diamond standard');
    console.error('Error details:', error.message);
    rl.close();
  }
}

// Main function
async function main() {
  // Create interface for user input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  // Load networks from hardhat config
  const networks = loadHardhatConfig() || {
    hardhat: 'http://localhost:8545',
    bscTestnet: process.env.BSC_TESTNET_URL || 'https://data-seed-prebsc-1-s1.binance.org:8545',
    bscMainnet: process.env.BSC_MAINNET_URL || 'https://bsc-dataseed.binance.org/'
  };

  // Load contract artifacts
  const { contractNames, contractFunctions } = loadContractArtifacts();
  console.log(`Loaded ${Object.keys(contractFunctions).length} contract artifacts`);

  console.log('Diamond Facets Checker');
  console.log('-----------------------');

  // Display available networks
  console.log('\nAvailable networks:');
  Object.keys(networks).forEach((network, index) => {
    console.log(`${index + 1}. ${network}`);
  });

  // Ask user to select a network
  rl.question('\nSelect network (enter number): ', async (selection) => {
    const networkIndex = parseInt(selection) - 1;
    const networkNames = Object.keys(networks);

    if (isNaN(networkIndex) || networkIndex < 0 || networkIndex >= networkNames.length) {
      console.error('Invalid selection. Exiting.');
      rl.close();
      return;
    }

    const selectedNetwork = networkNames[networkIndex];
    const RPC_URL = networks[selectedNetwork];

    console.log(`\nSelected network: ${selectedNetwork}`);
    console.log(`RPC URL: ${RPC_URL}`);

    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      await provider.getBlockNumber(); // Test connection
      console.log('Connected successfully!\n');

      // Ask for contract address
      rl.question('Enter contract address to check: ', async (address) => {
        try {
          // Validate address
          if (!ethers.isAddress(address)) {
            console.error('Invalid Ethereum address format');
            rl.close();
            return;
          }

          console.log(`Checking contract at ${address}...`);
          await processDiamondContract(address, provider, selectedNetwork, rl, contractFunctions);
        } catch (error: any) {
          console.error('An error occurred:', error.message);
          rl.close();
        }
      });
    } catch (error: any) {
      console.error(`Failed to connect to ${selectedNetwork}: ${error.message}`);
      rl.close();
    }
  });
}

// Execute main function
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
}); 
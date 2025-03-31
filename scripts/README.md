# Pay2Reach Diamond Contract Deployment Guide

This directory contains scripts to deploy the Pay2Reach Diamond Contract and its facets to various networks.

## Prerequisites

Before deploying, make sure you have:

1. Installed all dependencies:
   ```
   npm install
   ```

2. Set up your `.env` file with the following variables:
   ```
   PRIVATE_KEY=your_private_key_here
   BSC_TESTNET_URL=your_bsc_testnet_url
   BSC_MAINNET_URL=your_bsc_mainnet_url
   BSCSCAN_API_KEY=your_bscscan_api_key
   ```

3. Ensure you have enough BNB for gas on your deployer account.

## Deployment Scripts

### `deploy.ts`

This is the main deployment script that:
- Deploys all facet contracts individually
- Deploys the Diamond contract
- Sets up the initial diamond configuration
- Saves deployment information to the `/deployments` directory

You can run this script directly with Hardhat:
```
npx hardhat run scripts/deploy.ts --network <network-name>
```

### `deploy-contract.ts`

This is a user-friendly interactive script that:
- Provides menu options for different networks
- Compiles contracts before deployment
- Shows warnings for mainnet deployment
- Displays deployment results and verification instructions

You can run this script with:
```
npx ts-node scripts/deploy-contract.ts
```

## Post-Deployment

After deployment:

1. Contract addresses are saved in the `/deployments/<network>.json` file.

2. To verify the contracts on BscScan:
   ```
   npx hardhat verify --network <network> <contract-address> <constructor-args>
   ```

3. For the Diamond contract, you'll need to verify it with:
   ```
   npx hardhat verify --network <network> <diamond-address> <owner-address> <diamond-cut-facet-address>
   ```

## Troubleshooting

If you encounter deployment issues:

1. Check that your `.env` file is properly configured.
2. Ensure you have enough BNB for gas fees.
3. Make sure all contracts compile successfully.
4. Check the Hardhat configuration in `hardhat.config.ts`.

## Security Considerations

- The deployer address will be set as the contract owner.
- Always test deployments on a testnet before mainnet deployment.
- Consider using a hardware wallet for mainnet deployments.
- Backup your deployment records securely. 
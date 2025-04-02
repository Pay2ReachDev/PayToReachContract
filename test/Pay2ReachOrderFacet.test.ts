import { expect } from "chai";
import hre from "hardhat";
import { getAddress, parseEther } from "viem";
import { time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { ethers } from "hardhat";

// FacetCutAction enum
enum FacetCutAction {
    Add = 0,
    Replace = 1,
    Remove = 2
}

describe("Pay2ReachOrderFacet Contract", function () {
    let diamondAddress: any;
    let orderFacet: any;
    let payFacet: any;
    let deployer: any;
    let kol: any;
    let user1: any;
    let user2: any;
    let mockToken: any;

    const ORDER_ID = 1n;
    const SENDER_SOCIAL_MEDIA_ID = "sender_test_account";
    const KOL_SOCIAL_MEDIA_ID = "kol_test_account";
    const ORDER_AMOUNT = parseEther("0.01"); // 0.01 ETH
    const ETH_ADDRESS = "0x0000000000000000000000000000000000000000";
    const PLATFORM_FEE = 50n; // 5% fee expressed as basis points (5% = 50/1000)

    // Helper function to get function selectors from a contract
    async function getSelectors(contractName: string): Promise<string[]> {
        const factory = await ethers.getContractFactory(contractName);
        const fragments = factory.interface.fragments;

        // Extract function signatures from ABI and calculate selectors
        return fragments
            .filter((f: any) => f.type === "function")
            .map((f: any) => factory.interface.getFunction(f.name)!.selector);
    }

    // Deploy contracts and set up test accounts
    beforeEach(async function () {
        const accounts = await hre.viem.getWalletClients();
        deployer = accounts[0];
        kol = accounts[1];
        user1 = accounts[2];
        user2 = accounts[3];

        // Deploy Diamond with facets
        // Deploy DiamondCutFacet
        const diamondCutFacet = await hre.viem.deployContract("DiamondCutFacet");

        // Deploy Diamond with owner and DiamondCutFacet
        const diamond = await hre.viem.deployContract("Diamond", [
            deployer.account.address,
            diamondCutFacet.address
        ]);

        diamondAddress = diamond.address;

        // Deploy facets
        const diamondLoupeFacet = await hre.viem.deployContract("DiamondLoupeFacet");
        const ownershipFacet = await hre.viem.deployContract("OwnershipFacet");
        const orderFacetContract = await hre.viem.deployContract("Pay2ReachOrderFacet");
        const payFacetContract = await hre.viem.deployContract("Pay2ReachPayFacet");

        // Get function selectors for facets
        const diamondLoupeSelectors = await getSelectors("DiamondLoupeFacet");
        const ownershipSelectors = await getSelectors("OwnershipFacet");
        const orderFacetSelectors = await getSelectors("Pay2ReachOrderFacet");
        const payFacetSelectors = await getSelectors("Pay2ReachPayFacet");

        // Connect to DiamondCut contract
        const diamondCutEthers = await ethers.getContractAt("IDiamondCut", diamondAddress);

        // Add facets to diamond using diamond cut
        const cut = [
            {
                facetAddress: diamondLoupeFacet.address,
                action: FacetCutAction.Add,
                functionSelectors: diamondLoupeSelectors
            },
            {
                facetAddress: ownershipFacet.address,
                action: FacetCutAction.Add,
                functionSelectors: ownershipSelectors
            },
            {
                facetAddress: orderFacetContract.address,
                action: FacetCutAction.Add,
                functionSelectors: orderFacetSelectors
            },
            {
                facetAddress: payFacetContract.address,
                action: FacetCutAction.Add,
                functionSelectors: payFacetSelectors
            }
        ];

        // Execute diamond cut
        const tx = await diamondCutEthers.diamondCut(
            cut,
            ethers.ZeroAddress, // No initialization
            "0x" // No calldata
        );
        await tx.wait();

        // Get Order Facet and Pay Facet at diamond address
        orderFacet = await hre.viem.getContractAt("Pay2ReachOrderFacet", diamondAddress);
        payFacet = await hre.viem.getContractAt("Pay2ReachPayFacet", diamondAddress);

        // Deploy mock ERC20 token with correct constructor parameters: name, symbol, and decimals
        mockToken = await hre.viem.deployContract("MockERC20", [
            "MockToken", // name
            "MTK",      // symbol
            18         // decimals
        ]);

        // Mint some tokens to user1
        await mockToken.write.mint([user1.account.address, parseEther("100")]);
    });

    describe("Order Creation and Retrieval", function () {
        it("should create an order with ETH payment", async function () {
            const deadline = BigInt(Math.floor(Date.now() / 1000) + 86400); // 1 day from now

            await orderFacet.write.createOrder(
                [ORDER_ID, SENDER_SOCIAL_MEDIA_ID, KOL_SOCIAL_MEDIA_ID, ORDER_AMOUNT, ETH_ADDRESS, deadline],
                { account: user1.account, value: ORDER_AMOUNT }
            );

            const order = await orderFacet.read.getOrder([ORDER_ID]);

            expect(order.id).to.equal(ORDER_ID);
            expect(order.senderSocialMediaId).to.equal(SENDER_SOCIAL_MEDIA_ID);
            expect(order.kolSocialMediaId).to.equal(KOL_SOCIAL_MEDIA_ID);
            expect(order.amount).to.equal(ORDER_AMOUNT);
            expect(order.token).to.equal(ETH_ADDRESS);
            expect(order.status).to.equal(0); // Pending status
        });

        it("should create an order with token payment", async function () {
            const deadline = BigInt(Math.floor(Date.now() / 1000) + 86400); // 1 day from now

            // First approve the diamond contract to spend tokens
            await mockToken.write.approve(
                [diamondAddress, ORDER_AMOUNT],
                { account: user1.account }
            );

            await orderFacet.write.createOrder(
                [ORDER_ID, SENDER_SOCIAL_MEDIA_ID, KOL_SOCIAL_MEDIA_ID, ORDER_AMOUNT, mockToken.address, deadline],
                { account: user1.account }
            );

            const order = await orderFacet.read.getOrder([ORDER_ID]);

            expect(order.id).to.equal(ORDER_ID);
            expect(order.senderSocialMediaId).to.equal(SENDER_SOCIAL_MEDIA_ID);
            expect(order.kolSocialMediaId).to.equal(KOL_SOCIAL_MEDIA_ID);
            expect(order.amount).to.equal(ORDER_AMOUNT);
            expect(order.token.toLowerCase()).to.equal(mockToken.address.toLowerCase());
            expect(order.status).to.equal(0); // Pending status
        });

        it("should not allow creating an order with incorrect ETH amount", async function () {
            const deadline = BigInt(Math.floor(Date.now() / 1000) + 86400); // 1 day from now

            await expect(
                orderFacet.write.createOrder(
                    [ORDER_ID, SENDER_SOCIAL_MEDIA_ID, KOL_SOCIAL_MEDIA_ID, ORDER_AMOUNT, ETH_ADDRESS, deadline],
                    { account: user1.account, value: ORDER_AMOUNT - parseEther("0.001") }
                )
            ).to.be.rejectedWith("Incorrect ETH amount sent");
        });

        it("should not allow creating the same order ID twice", async function () {
            const deadline = BigInt(Math.floor(Date.now() / 1000) + 86400); // 1 day from now

            await orderFacet.write.createOrder(
                [ORDER_ID, SENDER_SOCIAL_MEDIA_ID, KOL_SOCIAL_MEDIA_ID, ORDER_AMOUNT, ETH_ADDRESS, deadline],
                { account: user1.account, value: ORDER_AMOUNT }
            );

            await expect(
                orderFacet.write.createOrder(
                    [ORDER_ID, SENDER_SOCIAL_MEDIA_ID, KOL_SOCIAL_MEDIA_ID, ORDER_AMOUNT, ETH_ADDRESS, deadline],
                    { account: user2.account, value: ORDER_AMOUNT }
                )
            ).to.be.rejectedWith("Order already exists");
        });

        it("should retrieve all orders", async function () {
            const deadline = BigInt(Math.floor(Date.now() / 1000) + 86400); // 1 day from now

            // Create first order
            await orderFacet.write.createOrder(
                [ORDER_ID, SENDER_SOCIAL_MEDIA_ID, KOL_SOCIAL_MEDIA_ID, ORDER_AMOUNT, ETH_ADDRESS, deadline],
                { account: user1.account, value: ORDER_AMOUNT }
            );

            // Create second order
            await orderFacet.write.createOrder(
                [ORDER_ID + 1n, SENDER_SOCIAL_MEDIA_ID, KOL_SOCIAL_MEDIA_ID, ORDER_AMOUNT, ETH_ADDRESS, deadline],
                { account: user2.account, value: ORDER_AMOUNT }
            );

            const orders = await orderFacet.read.getOrders();

            expect(orders.length).to.equal(2);
            expect(orders[0].id).to.equal(ORDER_ID);
            expect(orders[1].id).to.equal(ORDER_ID + 1n);
        });
    });

    describe("Order Management", function () {
        beforeEach(async function () {
            const deadline = BigInt(Math.floor(Date.now() / 1000) + 86400); // 1 day from now

            // Create an order with ETH
            await orderFacet.write.createOrder(
                [ORDER_ID, SENDER_SOCIAL_MEDIA_ID, KOL_SOCIAL_MEDIA_ID, ORDER_AMOUNT, ETH_ADDRESS, deadline],
                { account: user1.account, value: ORDER_AMOUNT }
            );
        });

        it("should allow contract owner to cancel an order", async function () {
            // Record initial balance
            const publicClient = await hre.viem.getPublicClient();
            const initialBalance = await publicClient.getBalance({
                address: user1.account.address
            });

            // Cancel order
            await orderFacet.write.cancelOrder(
                [ORDER_ID, SENDER_SOCIAL_MEDIA_ID, PLATFORM_FEE],
                { account: deployer.account }
            );

            // Check order status
            const order = await orderFacet.read.getOrder([ORDER_ID]);
            expect(order.status).to.equal(2); // Cancelled status

            // Verify refund (should be amount minus fee)
            const newBalance = await publicClient.getBalance({
                address: user1.account.address
            });

            // Calculate expected refund (minus platform fee)
            const expectedRefund = ORDER_AMOUNT - (ORDER_AMOUNT * PLATFORM_FEE) / 1000n;

            // Balance should have increased, accounting for gas costs
            expect(Number(newBalance)).to.closeTo(Number(initialBalance) + Number(expectedRefund), 1e16);
        });

        it("should not allow cancelling order with incorrect sender", async function () {
            await expect(
                orderFacet.write.cancelOrder(
                    [ORDER_ID, "wrong_sender_id", PLATFORM_FEE],
                    { account: deployer.account }
                )
            ).to.be.rejectedWith("Sender social media id does not match");
        });

        it("should allow contract owner to mark order as answered", async function () {
            // Record initial balance
            const publicClient = await hre.viem.getPublicClient();
            const initialKolBalance = await publicClient.getBalance({
                address: kol.account.address
            });

            // Answer order
            const tx = await orderFacet.write.answerOrder(
                [ORDER_ID, kol.account.address, PLATFORM_FEE],
                { account: deployer.account }
            );



            // Check order status
            const order = await orderFacet.read.getOrder([ORDER_ID]);
            expect(order.status).to.equal(1); // Answered status
            expect(order.answerTimestamp).to.not.equal(0);

            // Verify KOL received payment
            const newKolBalance = await publicClient.getBalance({
                address: kol.account.address
            });

            // Calculate expected payment (minus platform fee)
            const expectedPayment = ORDER_AMOUNT - (ORDER_AMOUNT * PLATFORM_FEE) / 1000n;

            // KOL balance should have increased
            expect(Number(newKolBalance)).to.closeTo(Number(initialKolBalance) + Number(expectedPayment), 1e16);
        });
    });
}); 
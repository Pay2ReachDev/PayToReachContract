import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
    deployDiamond,
    FacetCutAction,
    getSelectors,
} from "../scripts/diamond";

describe("Pay2ReachTokenFacet", function () {
    async function deployTokenFixture() {
        const [owner, user1, user2] = await ethers.getSigners();

        // Deploy test ERC20 token
        const MockToken = await ethers.getContractFactory("MockERC20");
        const mockToken = await MockToken.deploy("Test Token", "TST", 18);
        await mockToken.deployed();

        // Mint tokens to user1
        await mockToken.mint(user1.address, ethers.utils.parseEther("1000"));

        // Deploy diamond with all facets
        const diamondAddress = await deployDiamond();
        const diamond = await ethers.getContractAt("Pay2ReachDiamond", diamondAddress);

        // Deploy the token facet
        const TokenFacet = await ethers.getContractFactory("Pay2ReachTokenFacet");
        const tokenFacet = await TokenFacet.deploy();
        await tokenFacet.deployed();

        // Deploy the order facet
        const OrderFacet = await ethers.getContractFactory("Pay2ReachOrderFacet");
        const orderFacet = await OrderFacet.deploy();
        await orderFacet.deployed();

        // Get facet cut interfaces
        const diamondCut = await ethers.getContractAt("IDiamondCut", diamond.address);

        // Add token facet to diamond
        const tokenSelectors = getSelectors(tokenFacet);
        await diamondCut.diamondCut(
            [{
                facetAddress: tokenFacet.address,
                action: FacetCutAction.Add,
                functionSelectors: tokenSelectors
            }],
            ethers.constants.AddressZero,
            "0x"
        );

        // Add order facet to diamond
        const orderSelectors = getSelectors(orderFacet);
        await diamondCut.diamondCut(
            [{
                facetAddress: orderFacet.address,
                action: FacetCutAction.Add,
                functionSelectors: orderSelectors
            }],
            ethers.constants.AddressZero,
            "0x"
        );

        const orderFacetOnDiamond = await ethers.getContractAt("Pay2ReachOrderFacet", diamond.address);
        const tokenFacetOnDiamond = await ethers.getContractAt("Pay2ReachTokenFacet", diamond.address);

        return { diamond, orderFacetOnDiamond, tokenFacetOnDiamond, mockToken, owner, user1, user2 };
    }

    describe("Token collection and payment", function () {
        it("Should collect tokens when an order is created", async function () {
            const { orderFacetOnDiamond, tokenFacetOnDiamond, mockToken, user1, user2 } = await loadFixture(deployTokenFixture);

            // Create order
            const orderId = 1;
            await orderFacetOnDiamond.createOrder(
                orderId,
                "user1_social",
                "kol_social",
                ethers.utils.parseEther("10"),
                0, // token will be set in collectOrderTokens
                Math.floor(Date.now() / 1000) + 86400 // 1 day from now
            );

            // Approve token spending
            const amount = ethers.utils.parseEther("10");
            await mockToken.connect(user1).approve(orderFacetOnDiamond.address, amount);

            // Collect tokens
            await orderFacetOnDiamond.connect(user1).collectOrderTokens(
                orderId,
                mockToken.address,
                amount
            );

            // Check token balance of contract
            const balance = await tokenFacetOnDiamond.getTokenBalance(mockToken.address);
            expect(balance).to.equal(amount);

            // Check order details
            const order = await orderFacetOnDiamond.getOrder(orderId);
            expect(order.token).to.equal(ethers.BigNumber.from(mockToken.address));
            expect(order.amount).to.equal(amount);
        });

        it("Should pay tokens to KOL when order is answered", async function () {
            const { orderFacetOnDiamond, mockToken, owner, user1, user2 } = await loadFixture(deployTokenFixture);

            // Create order
            const orderId = 1;
            await orderFacetOnDiamond.createOrder(
                orderId,
                "user1_social",
                "kol_social",
                ethers.utils.parseEther("10"),
                0,
                Math.floor(Date.now() / 1000) + 86400
            );

            // Approve token spending
            const amount = ethers.utils.parseEther("10");
            await mockToken.connect(user1).approve(orderFacetOnDiamond.address, amount);

            // Collect tokens
            await orderFacetOnDiamond.connect(user1).collectOrderTokens(
                orderId,
                mockToken.address,
                amount
            );

            // Initial KOL balance
            const initialKolBalance = await mockToken.balanceOf(user2.address);

            // Answer order (owner only)
            await orderFacetOnDiamond.connect(owner).answerOrder(orderId, user2.address);

            // Check KOL's token balance
            const finalKolBalance = await mockToken.balanceOf(user2.address);
            expect(finalKolBalance.sub(initialKolBalance)).to.equal(amount);

            // Order should be marked as answered
            const order = await orderFacetOnDiamond.getOrder(orderId);
            expect(order.status).to.equal(1); // Answered status
        });
    });
}); 
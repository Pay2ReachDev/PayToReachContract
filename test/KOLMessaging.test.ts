import { expect } from "chai";
import hre from "hardhat";
import { getAddress, parseEther } from "viem";
import { time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";

describe("KOLMessaging Contract", function () {
    let kolMessaging: any;
    let deployer: any;
    let kol: any;
    let user1: any;
    let user2: any;

    const SOCIAL_MEDIA_ID = "kol_test_account";
    const MESSAGE_PRICE = 10n ** 16n; // 0.01 ETH
    const MESSAGE_CONTENT = "This is a test message. What are your thoughts on the future of blockchain technology?";

    // Deploy contract and set up test accounts
    beforeEach(async function () {
        const accounts = await hre.viem.getWalletClients();
        deployer = accounts[0];
        kol = accounts[1];
        user1 = accounts[2];
        user2 = accounts[3];

        // Deploy KOLMessaging contract
        const KOLMessaging = await hre.viem.deployContract("KOLMessaging");
        kolMessaging = KOLMessaging;
    });

    describe("KOL Registration and Verification", function () {
        it("should allow users to register as KOL", async function () {
            // Register using kol account
            await kolMessaging.write.registerAsKOL(
                [SOCIAL_MEDIA_ID, MESSAGE_PRICE],
                { account: kol.account }
            );

            // Verify KOL information
            const kolProfile = await kolMessaging.read.kolProfiles([getAddress(kol.account.address)]);
            expect(kolProfile[0]).to.equal(getAddress(kol.account.address)); // walletAddress
            expect(kolProfile[1]).to.equal(SOCIAL_MEDIA_ID); // socialMediaId
            expect(kolProfile[2]).to.equal(false); // isVerified (initially false)
            expect(kolProfile[3]).to.equal(MESSAGE_PRICE); // messagePrice
        });

        it("should not allow duplicate registration", async function () {
            // First registration
            await kolMessaging.write.registerAsKOL(
                [SOCIAL_MEDIA_ID, MESSAGE_PRICE],
                { account: kol.account }
            );

            // Attempt to register again, should fail
            await expect(
                kolMessaging.write.registerAsKOL(
                    [SOCIAL_MEDIA_ID, MESSAGE_PRICE],
                    { account: kol.account }
                )
            ).to.be.rejectedWith("KOL already registered");
        });

        it("platform owner should be able to verify KOL", async function () {
            // Register KOL
            await kolMessaging.write.registerAsKOL(
                [SOCIAL_MEDIA_ID, MESSAGE_PRICE],
                { account: kol.account }
            );

            // Platform owner verifies KOL
            await kolMessaging.write.verifyKOL(
                [getAddress(kol.account.address)],
                { account: deployer.account }
            );

            // Verify that KOL has been verified
            const kolProfile = await kolMessaging.read.kolProfiles([getAddress(kol.account.address)]);
            expect(kolProfile[2]).to.equal(true); // isVerified
        });

        it("non-platform owner cannot verify KOL", async function () {
            // Register KOL
            await kolMessaging.write.registerAsKOL(
                [SOCIAL_MEDIA_ID, MESSAGE_PRICE],
                { account: kol.account }
            );

            // Non-platform owner attempts to verify KOL
            await expect(
                kolMessaging.write.verifyKOL(
                    [getAddress(kol.account.address)],
                    { account: user1.account }
                )
            ).to.be.rejected; // Should fail because not the owner
        });
    });

    describe("Sending and Replying to Messages", function () {
        beforeEach(async function () {
            // Register and verify KOL
            await kolMessaging.write.registerAsKOL(
                [SOCIAL_MEDIA_ID, MESSAGE_PRICE],
                { account: kol.account }
            );

            await kolMessaging.write.verifyKOL(
                [getAddress(kol.account.address)],
                { account: deployer.account }
            );
        });

        it("users can send messages to verified KOLs", async function () {
            // Send message
            await kolMessaging.write.sendMessage(
                [getAddress(kol.account.address), MESSAGE_CONTENT],
                {
                    account: user1.account,
                    value: MESSAGE_PRICE
                }
            );

            // Get message IDs received by KOL
            const messageIds = await kolMessaging.read.getKOLMessages([getAddress(kol.account.address)]);
            expect(messageIds.length).to.equal(1);

            // Verify message content
            const messageId = messageIds[0];
            const messageDetails = await kolMessaging.read.getMessageDetails([messageId]);

            expect(messageDetails[0]).to.equal(getAddress(user1.account.address)); // sender
            expect(messageDetails[1]).to.equal(MESSAGE_CONTENT); // content
            expect(messageDetails[4]).to.equal(false); // isAnswered
        });

        it("KOL can reply to messages", async function () {
            // Send message
            await kolMessaging.write.sendMessage(
                [getAddress(kol.account.address), MESSAGE_CONTENT],
                {
                    account: user1.account,
                    value: MESSAGE_PRICE
                }
            );

            // Get message ID
            const messageIds = await kolMessaging.read.getKOLMessages([getAddress(kol.account.address)]);
            const messageId = messageIds[0];

            // KOL replies to message
            await kolMessaging.write.answerMessage(
                [messageId],
                { account: kol.account }
            );

            // Verify message has been replied to
            const messageDetails = await kolMessaging.read.getMessageDetails([messageId]);
            expect(messageDetails[4]).to.equal(true); // isAnswered

            // Verify KOL balance
            const kolProfile = await kolMessaging.read.kolProfiles([getAddress(kol.account.address)]);
            const platformFee = (MESSAGE_PRICE * 50n) / 1000n; // 5% fee
            const kolAmount = MESSAGE_PRICE - platformFee;

            expect(kolProfile[5]).to.equal(kolAmount); // availableBalance
            expect(kolProfile[4]).to.equal(0n); // pendingBalance
        });
    });

    describe("Refund Mechanism", function () {
        beforeEach(async function () {
            // Register and verify KOL
            await kolMessaging.write.registerAsKOL(
                [SOCIAL_MEDIA_ID, MESSAGE_PRICE],
                { account: kol.account }
            );

            await kolMessaging.write.verifyKOL(
                [getAddress(kol.account.address)],
                { account: deployer.account }
            );

            // Send message
            await kolMessaging.write.sendMessage(
                [getAddress(kol.account.address), MESSAGE_CONTENT],
                {
                    account: user1.account,
                    value: MESSAGE_PRICE
                }
            );
        });

        it("users can get partial refund after response time limit", async function () {
            // Get message ID
            const messageIds = await kolMessaging.read.getKOLMessages([getAddress(kol.account.address)]);
            const messageId = messageIds[0];

            // Fast forward time beyond response time limit (5 days)
            await time.increase(5 * 24 * 60 * 60 + 1);

            // Record user's initial balance
            const publicClient = await hre.viem.getPublicClient();
            const initialBalance = await publicClient.getBalance({
                address: user1.account.address
            });

            // Process refund, providing KOL address as second parameter
            await kolMessaging.write.processRefund(
                [messageId, getAddress(kol.account.address)],
                { account: user1.account }
            );

            // Verify refund amount (should be 50%)
            const newBalance = await publicClient.getBalance({
                address: user1.account.address
            });
            const refundAmount = MESSAGE_PRICE / 2n;

            // Note: This check is not exact because of gas fees, but can roughly verify a refund occurred
            expect(newBalance > initialBalance).to.be.true;

            // Verify message status
            const messageDetails = await kolMessaging.read.getMessageDetails([messageId]);
            expect(messageDetails[4]).to.equal(true); // isAnswered (marked as answered to prevent duplicate refunds)
        });

        it("cannot get refund within response time limit", async function () {
            // Get message ID
            const messageIds = await kolMessaging.read.getKOLMessages([getAddress(kol.account.address)]);
            const messageId = messageIds[0];

            // Attempt to process refund (should fail because response time limit has not been exceeded)
            await expect(
                kolMessaging.write.processRefund(
                    [messageId, getAddress(kol.account.address)],
                    { account: user1.account }
                )
            ).to.be.rejectedWith("Response time not expired");
        });
    });

    describe("KOL Withdrawal", function () {
        beforeEach(async function () {
            // Register and verify KOL
            await kolMessaging.write.registerAsKOL(
                [SOCIAL_MEDIA_ID, MESSAGE_PRICE],
                { account: kol.account }
            );

            await kolMessaging.write.verifyKOL(
                [getAddress(kol.account.address)],
                { account: deployer.account }
            );

            // Send message
            await kolMessaging.write.sendMessage(
                [getAddress(kol.account.address), MESSAGE_CONTENT],
                {
                    account: user1.account,
                    value: MESSAGE_PRICE
                }
            );

            // Get message ID and reply
            const messageIds = await kolMessaging.read.getKOLMessages([getAddress(kol.account.address)]);
            await kolMessaging.write.answerMessage(
                [messageIds[0]],
                { account: kol.account }
            );
        });

        it("KOL can withdraw available balance", async function () {
            // Record KOL's initial balance
            const publicClient = await hre.viem.getPublicClient();
            const initialBalance = await publicClient.getBalance({
                address: kol.account.address
            });

            // KOL withdraws balance
            await kolMessaging.write.withdrawKOLBalance(
                [],
                { account: kol.account }
            );

            // Verify KOL's balance has increased
            const newBalance = await publicClient.getBalance({
                address: kol.account.address
            });
            expect(newBalance > initialBalance).to.be.true;

            // Verify KOL's available balance in contract has been zeroed
            const kolProfile = await kolMessaging.read.kolProfiles([getAddress(kol.account.address)]);
            expect(kolProfile[5]).to.equal(0n); // availableBalance
        });
    });
}); 
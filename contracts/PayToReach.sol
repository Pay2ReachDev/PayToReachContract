// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title Pay2Reach
 * @dev A platform for messaging Key Opinion Leaders (KOLs) on BSC
 */
contract Pay2Reach is Ownable, ReentrancyGuard {
    // Maximum message length (2000 characters)
    uint256 public constant MAX_MESSAGE_LENGTH = 2000;

    // Response time limit in seconds (5 days)
    uint256 public constant RESPONSE_TIME_LIMIT = 5 days;

    // Platform fee percentage (base 1000, so 50 = 5%)
    uint256 public constant PLATFORM_FEE = 50; // 5% fee

    // Structure to store KOL profiles
    struct KOLProfile {
        address payable walletAddress;
        string socialMediaId;
        bool isVerified;
        uint256 messagePrice; // in BNB (wei)
        uint256 pendingBalance;
        uint256 availableBalance;
    }

    // Structure to store messages
    struct Message {
        address sender;
        string content;
        uint256 timestamp;
        uint256 amount;
        bool isAnswered;
        uint256 answerTimestamp;
    }

    // Mapping from KOL address to their profile
    mapping(address => KOLProfile) public kolProfiles;

    // Mapping from KOL address to an array of message IDs
    mapping(address => uint256[]) public kolMessages;

    // Mapping from message ID to the message
    mapping(uint256 => Message) public messages;

    // Counter for message IDs
    uint256 private messageIdCounter;

    // Events
    event KOLRegistered(
        address indexed kolAddress,
        string socialMediaId,
        uint256 messagePrice
    );
    event KOLVerified(address indexed kolAddress);
    event MessageSent(
        uint256 indexed messageId,
        address indexed sender,
        address indexed recipient,
        uint256 amount
    );
    event MessageAnswered(
        uint256 indexed messageId,
        address indexed kolAddress,
        uint256 timestamp
    );
    event MessageRefunded(
        uint256 indexed messageId,
        address indexed sender,
        uint256 amount
    );
    event KOLWithdrawal(address indexed kolAddress, uint256 amount);

    /**
     * @dev Constructor
     */
    constructor() {
        messageIdCounter = 1;
    }

    /**
     * @dev Register as a KOL
     * @param _socialMediaId Social media identifier (X or LinkedIn handle)
     * @param _messagePrice Price in BNB to receive messages
     */
    function registerAsKOL(
        string memory _socialMediaId,
        uint256 _messagePrice
    ) external {
        require(bytes(_socialMediaId).length > 0, "Invalid social media ID");
        require(_messagePrice > 0, "Message price must be greater than 0");
        require(
            kolProfiles[msg.sender].walletAddress == address(0),
            "KOL already registered"
        );

        kolProfiles[msg.sender] = KOLProfile({
            walletAddress: payable(msg.sender),
            socialMediaId: _socialMediaId,
            isVerified: false,
            messagePrice: _messagePrice,
            pendingBalance: 0,
            availableBalance: 0
        });

        emit KOLRegistered(msg.sender, _socialMediaId, _messagePrice);
    }

    /**
     * @dev Platform verifies a KOL
     * @param _kolAddress Address of the KOL to verify
     */
    function verifyKOL(address _kolAddress) external onlyOwner {
        require(
            kolProfiles[_kolAddress].walletAddress != address(0),
            "KOL not registered"
        );
        kolProfiles[_kolAddress].isVerified = true;

        emit KOLVerified(_kolAddress);
    }

    /**
     * @dev Send a message to a KOL
     * @param _kolAddress Address of the KOL
     * @param _messageContent Content of the message
     */
    function sendMessage(
        address _kolAddress,
        string memory _messageContent
    ) external payable nonReentrant {
        KOLProfile storage kol = kolProfiles[_kolAddress];

        require(kol.walletAddress != address(0), "KOL not registered");
        require(kol.isVerified, "KOL not verified");
        require(msg.value == kol.messagePrice, "Incorrect payment amount");
        require(
            bytes(_messageContent).length <= MAX_MESSAGE_LENGTH,
            "Message too long"
        );

        uint256 messageId = messageIdCounter++;

        messages[messageId] = Message({
            sender: msg.sender,
            content: _messageContent,
            timestamp: block.timestamp,
            amount: msg.value,
            isAnswered: false,
            answerTimestamp: 0
        });

        kolMessages[_kolAddress].push(messageId);
        kol.pendingBalance += msg.value;

        emit MessageSent(messageId, msg.sender, _kolAddress, msg.value);
    }

    /**
     * @dev KOL answers a message
     * @param _messageId ID of the message to answer
     */
    function answerMessage(uint256 _messageId) external nonReentrant {
        Message storage message = messages[_messageId];
        KOLProfile storage kol = kolProfiles[msg.sender];

        require(kol.walletAddress != address(0), "KOL not registered");
        require(!message.isAnswered, "Message already answered");

        bool isMessageForKOL = false;
        for (uint256 i = 0; i < kolMessages[msg.sender].length; i++) {
            if (kolMessages[msg.sender][i] == _messageId) {
                isMessageForKOL = true;
                break;
            }
        }
        require(isMessageForKOL, "Message not for this KOL");

        message.isAnswered = true;
        message.answerTimestamp = block.timestamp;

        uint256 platformFeeAmount = (message.amount * PLATFORM_FEE) / 1000;
        uint256 kolAmount = message.amount - platformFeeAmount;

        kol.pendingBalance -= message.amount;
        kol.availableBalance += kolAmount;

        emit MessageAnswered(_messageId, msg.sender, block.timestamp);
    }

    /**
     * @dev Process refunds for unanswered messages past the time limit
     * @param _messageId ID of the message to potentially refund
     * @param _kolAddress The address of the KOL who received the message
     */
    function processRefund(
        uint256 _messageId,
        address _kolAddress
    ) external nonReentrant {
        Message storage message = messages[_messageId];
        KOLProfile storage kol = kolProfiles[_kolAddress];

        require(!message.isAnswered, "Message already answered");
        require(
            block.timestamp > message.timestamp + RESPONSE_TIME_LIMIT,
            "Response time not expired"
        );

        // Verify that the message was indeed sent to this KOL
        bool isMessageForKOL = false;
        for (uint256 i = 0; i < kolMessages[_kolAddress].length; i++) {
            if (kolMessages[_kolAddress][i] == _messageId) {
                isMessageForKOL = true;
                break;
            }
        }
        require(isMessageForKOL, "Message not for this KOL");

        uint256 refundAmount = message.amount / 2; // 50% refund
        uint256 platformFeeAmount = (message.amount * PLATFORM_FEE) / 1000;
        uint256 kolAmount = message.amount - refundAmount - platformFeeAmount;

        kol.pendingBalance -= message.amount;
        kol.availableBalance += kolAmount;

        // Mark message as answered to prevent double refunds
        message.isAnswered = true;
        message.answerTimestamp = block.timestamp;

        // Send refund to the original sender
        (bool sent, ) = message.sender.call{value: refundAmount}("");
        require(sent, "Failed to send refund");

        emit MessageRefunded(_messageId, message.sender, refundAmount);
    }

    /**
     * @dev KOL withdraws their available balance
     */
    function withdrawKOLBalance() external nonReentrant {
        KOLProfile storage kol = kolProfiles[msg.sender];

        require(kol.walletAddress != address(0), "KOL not registered");
        require(kol.availableBalance > 0, "No balance to withdraw");

        uint256 amount = kol.availableBalance;
        kol.availableBalance = 0;

        (bool sent, ) = msg.sender.call{value: amount}("");
        require(sent, "Failed to send BNB");

        emit KOLWithdrawal(msg.sender, amount);
    }

    /**
     * @dev Platform owner withdraws accumulated fees
     */
    function withdrawPlatformFees() external onlyOwner {
        uint256 balance = address(this).balance;

        // Calculate total of pending and available KOL balances
        uint256 totalKOLBalance = 0;
        address[] memory kolAddresses = new address[](100); // Adjust size as needed
        uint256 kolCount = 0;

        // This is simplified and would need pagination for production
        // Real implementation would need to track KOLs and platform balance separately

        uint256 platformBalance = balance - totalKOLBalance;
        require(platformBalance > 0, "No platform fees to withdraw");

        (bool sent, ) = owner().call{value: platformBalance}("");
        require(sent, "Failed to send platform fees");
    }

    /**
     * @dev KOL updates their message price
     * @param _newPrice New price in BNB
     */
    function updateMessagePrice(uint256 _newPrice) external {
        require(
            kolProfiles[msg.sender].walletAddress != address(0),
            "KOL not registered"
        );
        require(_newPrice > 0, "Message price must be greater than 0");

        kolProfiles[msg.sender].messagePrice = _newPrice;
    }

    /**
     * @dev Get messages for a KOL
     * @param _kolAddress Address of the KOL
     * @return Array of message IDs
     */
    function getKOLMessages(
        address _kolAddress
    ) external view returns (uint256[] memory) {
        return kolMessages[_kolAddress];
    }

    /**
     * @dev Get message details
     * @param _messageId ID of the message
     * @return sender Message sender
     * @return content Message content
     * @return timestamp Message timestamp
     * @return amount Amount paid
     * @return isAnswered Whether the message has been answered
     * @return answerTimestamp When the message was answered
     */
    function getMessageDetails(
        uint256 _messageId
    )
        external
        view
        returns (
            address sender,
            string memory content,
            uint256 timestamp,
            uint256 amount,
            bool isAnswered,
            uint256 answerTimestamp
        )
    {
        Message memory message = messages[_messageId];
        return (
            message.sender,
            message.content,
            message.timestamp,
            message.amount,
            message.isAnswered,
            message.answerTimestamp
        );
    }
}

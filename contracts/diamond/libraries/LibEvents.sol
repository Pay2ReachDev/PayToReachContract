// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

library LibEvents {
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
}

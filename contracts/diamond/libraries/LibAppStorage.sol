// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

library LibAppStorage {
    uint256 public constant FEE_PRECISION = 10000;

    struct Config {
        uint256 responseTimeLimit;
        address platformFee;
        uint256 platformFeePercentage;
    }

    enum OrderStatus {
        Pending,
        Answered,
        Cancelled
    }

    struct Order {
        uint256 id;
        string senderSocialMediaId;
        string kolSocialMediaId;
        uint256 amount;
        address token;
        uint256 timestamp;
        OrderStatus status;
        uint256 startTimestamp;
        uint256 answerTimestamp;
        uint256 deadline;
        address sender;
    }

    struct AppStorage {
        Config config;
        EnumerableSet.UintSet orderIds;
        mapping(uint256 => Order) orders;
    }

    // This is the Diamond Storage Pattern
    bytes32 constant DIAMOND_STORAGE_POSITION =
        keccak256("pay2reach.app.storage");

    function appStorage() internal pure returns (AppStorage storage ds) {
        bytes32 position = DIAMOND_STORAGE_POSITION;
        assembly {
            ds.slot := position
        }
    }
}

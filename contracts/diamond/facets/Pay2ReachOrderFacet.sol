// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../libraries/LibAppStorage.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../LibDiamond.sol";
import "./Pay2ReachPayFacet.sol";

contract Pay2ReachOrderFacet is ReentrancyGuard {
    using LibAppStorage for LibAppStorage.AppStorage;
    using EnumerableSet for EnumerableSet.UintSet;

    function createOrder(
        uint256 _id,
        string memory _senderSocialMediaId,
        string memory _kolSocialMediaId,
        uint256 _amount,
        address _token,
        uint256 _deadline
    ) external nonReentrant {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();

        // Add order ID to the set
        if (!s.orderIds.add(_id)) {
            revert("Order already exists");
        }

        s.orders[_id] = LibAppStorage.Order({
            id: _id,
            senderSocialMediaId: _senderSocialMediaId,
            kolSocialMediaId: _kolSocialMediaId,
            amount: _amount,
            token: _token,
            timestamp: block.timestamp,
            status: LibAppStorage.OrderStatus.Pending,
            startTimestamp: block.timestamp,
            answerTimestamp: 0,
            deadline: _deadline
        });

        _collectOrderTokens(_id, _token, _amount);
    }

    function getOrder(
        uint256 _id
    ) external view returns (LibAppStorage.Order memory) {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        return s.orders[_id];
    }

    function getOrders() external view returns (LibAppStorage.Order[] memory) {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        uint256[] memory orderIds = s.orderIds.values();
        LibAppStorage.Order[] memory orders = new LibAppStorage.Order[](
            orderIds.length
        );
        for (uint256 i = 0; i < orderIds.length; i++) {
            orders[i] = s.orders[orderIds[i]];
        }
        return orders;
    }

    function cancelOrder(
        uint256 _id,
        string memory _senderSocialMediaId
    ) external nonReentrant {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        LibAppStorage.Order storage order = s.orders[_id];
        require(
            order.status == LibAppStorage.OrderStatus.Pending,
            "Order is not pending"
        );

        if (
            keccak256(abi.encodePacked(order.senderSocialMediaId)) ==
            keccak256(abi.encodePacked(_senderSocialMediaId))
        ) {
            order.status = LibAppStorage.OrderStatus.Cancelled;
        } else {
            revert("Sender social media id does not match");
        }
    }

    function answerOrder(uint256 _id, address _kolAddress) external {
        LibDiamond.enforceIsContractOwner();
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        LibAppStorage.Order storage order = s.orders[_id];
        order.answerTimestamp = block.timestamp;
        order.status = LibAppStorage.OrderStatus.Answered;

        // Pay tokens to KOL
        Pay2ReachPayFacet payFacet = Pay2ReachPayFacet(address(this));
        payFacet.payTokens(_id, _kolAddress);
    }

    // New function to collect tokens for an order
    function _collectOrderTokens(
        uint256 _id,
        address _tokenAddress,
        uint256 _amount
    ) internal nonReentrant {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        LibAppStorage.Order storage order = s.orders[_id];
        require(
            order.status == LibAppStorage.OrderStatus.Pending,
            "Order is not pending"
        );

        // Collect tokens from sender
        Pay2ReachPayFacet payFacet = Pay2ReachPayFacet(address(this));
        payFacet.collectTokens(_id, _amount, _tokenAddress, msg.sender);
    }
}

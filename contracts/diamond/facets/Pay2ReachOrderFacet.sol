// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "../libraries/LibAppStorage.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../LibDiamond.sol";
import "./Pay2ReachPayFacet.sol";

contract Pay2ReachOrderFacet is ReentrancyGuard {
    using LibAppStorage for LibAppStorage.AppStorage;
    using EnumerableSet for EnumerableSet.UintSet;

    // Address constant for representing ETH
    address constant ETH_ADDRESS = address(0);

    event SetFeeRecipient(
        address indexed previousFeeRecipient,
        address indexed newFeeRecipient
    );
    event AddWhitelistedToken(address indexed token);
    event RemoveWhitelistedToken(address indexed token);

    function setFeeRecipient(address _feeRecipient) external {
        LibDiamond.enforceIsContractOwner();
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        address previousFeeRecipient = s.config.platformFee;
        s.config.platformFee = _feeRecipient;
        emit SetFeeRecipient(previousFeeRecipient, _feeRecipient);
    }

    function getFeeRecipient() external view returns (address) {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        return s.config.platformFee;
    }

    function addWhitelistedToken(address _token) external {
        LibDiamond.enforceIsContractOwner();
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        s.whitelistedTokens[_token] = true;
        emit AddWhitelistedToken(_token);
    }

    function removeWhitelistedToken(address _token) external {
        LibDiamond.enforceIsContractOwner();
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        s.whitelistedTokens[_token] = false;
        emit RemoveWhitelistedToken(_token);
    }

    function isWhitelistedToken(address _token) external view returns (bool) {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        return s.whitelistedTokens[_token];
    }

    function createOrder(
        uint256 _id,
        string memory _senderSocialMediaId,
        string memory _kolSocialMediaId,
        uint256 _amount,
        address _token,
        uint256 _deadline
    ) external payable nonReentrant {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();

        // Add order ID to the set
        if (!s.orderIds.add(_id)) {
            revert("Order already exists");
        }

        require(s.whitelistedTokens[_token], "Token is not whitelisted");

        // For ETH payments, validate amount
        if (_token == ETH_ADDRESS) {
            require(msg.value == _amount, "Incorrect ETH amount sent");
        } else {
            // For token payments, ensure no ETH was sent
            require(msg.value == 0, "ETH sent with token order");
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
            deadline: _deadline,
            sender: msg.sender
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
        string memory _senderSocialMediaId,
        uint256 _fee
    ) external nonReentrant {
        LibDiamond.enforceIsContractOwner();
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

        Pay2ReachPayFacet payFacet = Pay2ReachPayFacet(payable(address(this)));
        payFacet.refundTokens(_id, order.sender, _fee);
    }

    function answerOrder(
        uint256 _id,
        address _kolAddress,
        uint256 _fee
    ) external {
        LibDiamond.enforceIsContractOwner();

        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        LibAppStorage.Order storage order = s.orders[_id];

        require(
            order.status == LibAppStorage.OrderStatus.Pending,
            "Order is not pending"
        );

        if (order.deadline < block.timestamp) {
            order.status = LibAppStorage.OrderStatus.Expired;

            // Refund tokens to sender
            Pay2ReachPayFacet payFacet = Pay2ReachPayFacet(
                payable(address(this))
            );
            payFacet.refundTokens(_id, order.sender, _fee);
        } else {
            order.answerTimestamp = block.timestamp;
            order.status = LibAppStorage.OrderStatus.Answered;
            // Pay tokens to KOL
            Pay2ReachPayFacet payFacet = Pay2ReachPayFacet(
                payable(address(this))
            );
            payFacet.payTokens(_id, _kolAddress, _fee);
        }
    }

    // Modified function to collect tokens for an order
    function _collectOrderTokens(
        uint256 _id,
        address _tokenAddress,
        uint256 _amount
    ) internal {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        LibAppStorage.Order storage order = s.orders[_id];
        require(
            order.status == LibAppStorage.OrderStatus.Pending,
            "Order is not pending"
        );

        // Handle ETH differently from ERC20 tokens
        if (_tokenAddress == ETH_ADDRESS) {
            // ETH is already transferred in the payable function
            // No need to do anything here
            emit Pay2ReachPayFacet.TokensCollected(
                _id,
                msg.sender,
                _amount,
                _tokenAddress
            );
        } else {
            // Collect ERC20 tokens from sender
            Pay2ReachPayFacet payFacet = Pay2ReachPayFacet(
                payable(address(this))
            );
            payFacet.collectTokens(_id, _amount, _tokenAddress, msg.sender);
        }
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../libraries/LibAppStorage.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../LibDiamond.sol";

contract Pay2ReachPayFacet is ReentrancyGuard {
    using LibAppStorage for LibAppStorage.AppStorage;
    using SafeERC20 for IERC20;

    modifier onlyOwnerOrSelf() {
        LibDiamond.enforceIsContractOwnerOrSelf();
        _;
    }

    // Events
    event TokensCollected(
        uint256 indexed orderId,
        address indexed sender,
        uint256 amount,
        address tokenAddress
    );
    event TokensPaid(
        uint256 indexed orderId,
        address indexed kolAddress,
        uint256 amount,
        address tokenAddress,
        uint256 fee
    );
    event TokensRefunded(
        uint256 indexed orderId,
        address indexed sender,
        uint256 amount,
        address tokenAddress
    );

    /**
     * @dev Collect tokens from user when an order is created
     * @param _orderId The ID of the order
     * @param _amount The amount of tokens to collect
     * @param _tokenAddress The address of the ERC20 token
     * @param _sender The address of the sender
     */
    function collectTokens(
        uint256 _orderId,
        uint256 _amount,
        address _tokenAddress,
        address _sender
    ) external nonReentrant onlyOwnerOrSelf {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        LibAppStorage.Order storage order = s.orders[_orderId];

        require(order.id == _orderId, "Order does not exist");
        require(
            order.status == LibAppStorage.OrderStatus.Pending,
            "Order is not pending"
        );
        require(_amount > 0, "Amount must be greater than 0");
        require(_tokenAddress != address(0), "Invalid token address");

        // Transfer tokens from sender to contract using SafeERC20
        IERC20 token = IERC20(_tokenAddress);
        token.safeTransferFrom(_sender, address(this), _amount);

        // Update order token details if not already set
        if (order.token == address(0)) {
            order.token = _tokenAddress;
            order.amount = _amount;
        }

        emit TokensCollected(_orderId, _sender, _amount, _tokenAddress);
    }

    function refundTokens(
        uint256 _orderId,
        address _sender
    ) external nonReentrant onlyOwnerOrSelf {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        LibAppStorage.Order storage order = s.orders[_orderId];

        require(order.id == _orderId, "Order does not exist");
        require(
            order.status == LibAppStorage.OrderStatus.Pending,
            "Order is not pending"
        );

        // Transfer tokens from contract to sender using SafeERC20
        IERC20 token = IERC20(order.token);
        token.safeTransfer(_sender, order.amount);

        emit TokensRefunded(_orderId, _sender, order.amount, order.token);
    }

    /**
     * @dev Pay tokens to KOL when an order is answered
     * @param _orderId The ID of the order
     * @param _kolAddress The address of the KOL to pay
     */
    function payTokens(
        uint256 _orderId,
        address _kolAddress
    ) external nonReentrant onlyOwnerOrSelf {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        LibAppStorage.Order storage order = s.orders[_orderId];

        require(order.id == _orderId, "Order does not exist");
        require(
            order.status == LibAppStorage.OrderStatus.Answered,
            "Order is not answered"
        );
        require(_kolAddress != address(0), "Invalid KOL address");

        uint256 fee = calculateFee(order.amount);
        uint256 amount = order.amount - fee;
        address tokenAddress = order.token;

        // Transfer tokens to KOL using SafeERC20
        IERC20 token = IERC20(tokenAddress);
        token.safeTransfer(_kolAddress, amount);

        emit TokensPaid(_orderId, _kolAddress, amount, tokenAddress, fee);
    }

    function calculateFee(uint256 _amount) internal view returns (uint256) {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();

        require(
            s.config.platformFee < LibAppStorage.FEE_PRECISION,
            "Fee is too high"
        );
        uint256 fee = s.config.platformFee;
        return (_amount * fee) / LibAppStorage.FEE_PRECISION;
    }
}

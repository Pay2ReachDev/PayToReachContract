# Pay2Reach Contract API Documentation

This document describes the external API interfaces for the Pay2Reach Diamond Contract, a platform for messaging Key Opinion Leaders (KOLs) on BSC.

## Overview

Pay2Reach is implemented using the Diamond Pattern (EIP-2535) which consists of multiple facets providing different functionalities. The main facets are:

1. Pay2ReachOrderFacet - Manages the creation and lifecycle of orders
2. Pay2ReachPayFacet - Handles token transfers between users and KOLs
3. PayToReachManageFacet - Manages platform configuration

## Data Structures

### Order

```solidity
struct Order {
    uint256 id;                   // Unique identifier for the order
    string senderSocialMediaId;   // Social media ID of the message sender
    string kolSocialMediaId;      // Social media ID of the KOL
    uint256 amount;               // Amount of tokens to be paid
    address token;                // Address of the ERC20 token used for payment
    uint256 timestamp;            // Timestamp when the order was created
    OrderStatus status;           // Current status of the order
    uint256 startTimestamp;       // Timestamp when the order started
    uint256 answerTimestamp;      // Timestamp when the order was answered
    uint256 deadline;             // Deadline for the order
}
```

### OrderStatus

```solidity
enum OrderStatus {
    Pending,    // Order has been created but not answered
    Answered,   // Order has been answered by the KOL
    Expired,    // Order has expired without being answered
    Cancelled   // Order was cancelled by the sender
}
```

### Config

```solidity
struct Config {
    uint256 responseTimeLimit;    // Time limit for KOLs to respond (in seconds)
    uint256 platformFee;          // Platform fee in basis points (1/10000)
}
```

## Order Management API

### createOrder

Creates a new message order for a KOL.

```solidity
function createOrder(
    uint256 _id,
    string memory _senderSocialMediaId,
    string memory _kolSocialMediaId,
    uint256 _amount,
    address _token,
    uint256 _deadline
) external
```

**Parameters:**
- `_id`: Unique identifier for the order
- `_senderSocialMediaId`: Social media identifier of the message sender
- `_kolSocialMediaId`: Social media identifier of the KOL
- `_amount`: Amount of tokens to pay
- `_token`: Address of the ERC20 token used for payment
- `_deadline`: Deadline timestamp for the order

**Behavior:**
- Creates a new order with Pending status
- Collects tokens from the sender
- Emits a TokensCollected event

### getOrder

Retrieves information about a specific order.

```solidity
function getOrder(
    uint256 _id
) external view returns (LibAppStorage.Order memory)
```

**Parameters:**
- `_id`: The order ID to retrieve

**Returns:**
- Complete order information

### getOrders

Retrieves all orders in the system.

```solidity
function getOrders() external view returns (LibAppStorage.Order[] memory)
```

**Returns:**
- Array of all orders

### cancelOrder

Cancels a pending order.

```solidity
function cancelOrder(
    uint256 _id,
    string memory _senderSocialMediaId
) external
```

**Parameters:**
- `_id`: The order ID to cancel
- `_senderSocialMediaId`: Social media ID of the sender (for verification)

**Behavior:**
- Changes order status to Cancelled if sender ID matches
- Reverts if order is not in Pending status or sender ID doesn't match

### answerOrder

Marks an order as answered by a KOL (admin only).

```solidity
function answerOrder(uint256 _id, address _kolAddress) external
```

**Parameters:**
- `_id`: The order ID to mark as answered
- `_kolAddress`: The wallet address of the KOL

**Behavior:**
- Updates order status to Answered
- Records the answer timestamp
- Transfers tokens to the KOL
- Emits a TokensPaid event

## Payment API

### collectTokens

Collects tokens from a user for a specific order (internal and contract use only).

```solidity
function collectTokens(
    uint256 _orderId,
    uint256 _amount,
    address _tokenAddress,
    address _sender
) external
```

**Parameters:**
- `_orderId`: The ID of the order
- `_amount`: Amount of tokens to collect
- `_tokenAddress`: Address of the ERC20 token
- `_sender`: Address of the token sender

**Behavior:**
- Transfers tokens from sender to contract
- Emits a TokensCollected event

### payTokens

Pays tokens to a KOL for answering an order (internal and contract use only).

```solidity
function payTokens(
    uint256 _orderId,
    address _kolAddress
) external
```

**Parameters:**
- `_orderId`: The ID of the order
- `_kolAddress`: Address of the KOL

**Behavior:**
- Calculates platform fee
- Transfers tokens to KOL after deducting fee
- Emits a TokensPaid event

## Configuration API

### setConfig

Sets the platform configuration (admin only).

```solidity
function setConfig(LibAppStorage.Config memory _config) external
```

**Parameters:**
- `_config`: New configuration settings

### getConfig

Retrieves the current platform configuration.

```solidity
function getConfig() external view returns (LibAppStorage.Config memory)
```

**Returns:**
- Current configuration settings

## Events

### TokensCollected

Emitted when tokens are collected from a user.

```solidity
event TokensCollected(
    uint256 indexed orderId,
    address indexed sender,
    uint256 amount,
    address tokenAddress
)
```

### TokensPaid

Emitted when tokens are paid to a KOL.

```solidity
event TokensPaid(
    uint256 indexed orderId,
    address indexed kolAddress,
    uint256 amount,
    address tokenAddress,
    uint256 fee
)
```

## Error Handling

The contract will revert with clear error messages in the following scenarios:

- Creating an order with an ID that already exists
- Operating on a non-existent order
- Attempting to collect or pay zero tokens
- Using an invalid token address
- Providing an invalid KOL address
- Cancelling an order with incorrect sender ID
- Attempting to pay for an order that is not in Answered status
- Setting a platform fee that exceeds the maximum allowed value 
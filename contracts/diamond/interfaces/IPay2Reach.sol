// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "../libraries/LibAppStorage.sol";

interface IPay2Reach {
    function createOrder(
        uint256 _id,
        string memory _senderSocialMediaId,
        string memory _kolSocialMediaId,
        uint256 _amount,
        address _token,
        uint256 _deadline
    ) external;

    function getOrder(
        uint256 _id
    ) external view returns (LibAppStorage.Order memory);

    function getOrders() external view returns (LibAppStorage.Order[] memory);

    function cancelOrder(
        uint256 _id,
        string memory _senderSocialMediaId,
        uint256 _fee
    ) external;

    function answerOrder(
        uint256 _id,
        address _kolAddress,
        uint256 _fee
    ) external;
}

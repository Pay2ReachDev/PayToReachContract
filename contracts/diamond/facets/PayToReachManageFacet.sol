// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../libraries/LibAppStorage.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract PayToReachManageFacet is ReentrancyGuard {
    using LibAppStorage for LibAppStorage.AppStorage;

    function setConfig(LibAppStorage.Config memory _config) external {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        s.config = _config;
    }

    function getConfig() external view returns (LibAppStorage.Config memory) {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        return s.config;
    }
}

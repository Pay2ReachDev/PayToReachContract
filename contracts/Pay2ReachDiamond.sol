// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./diamond/Diamond.sol";

/**
 * @title Pay2ReachDiamond
 * @dev A platform for messaging Key Opinion Leaders (KOLs) on BSC, implemented using the Diamond Pattern (EIP-2535)
 */
contract Pay2ReachDiamond is Diamond {
    /**
     * @dev Constructor
     * @param _owner Address of the contract owner
     * @param _diamondCutFacet Address of the DiamondCutFacet
     */
    constructor(
        address _owner,
        address _diamondCutFacet
    ) Diamond(_owner, _diamondCutFacet) {
        // All initialization is done in the Diamond constructor
    }
}

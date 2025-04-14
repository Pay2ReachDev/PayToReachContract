// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IDiamondLoupe {
    /// @notice Gets all facet addresses and their function selectors.
    /// @return facets_ Facet information
    function facets() external view returns (Facet[] memory facets_);

    /// @notice Gets all the function selectors provided by a facet.
    /// @param _facet The facet address.
    /// @return facetFunctionSelectors_ Function selectors provided by the facet
    function facetFunctionSelectors(
        address _facet
    ) external view returns (bytes4[] memory facetFunctionSelectors_);

    /// @notice Get all the facet addresses used by a diamond.
    /// @return facetAddresses_ Facet addresses
    function facetAddresses()
        external
        view
        returns (address[] memory facetAddresses_);

    /// @notice Gets the facet that supports the given selector.
    /// @param _functionSelector Function selector.
    /// @return facetAddress_ The facet address that provides the function
    function facetAddress(
        bytes4 _functionSelector
    ) external view returns (address facetAddress_);

    /// The Facet struct holds both the address of the facet and its function selectors
    struct Facet {
        address facetAddress;
        bytes4[] functionSelectors;
    }
}

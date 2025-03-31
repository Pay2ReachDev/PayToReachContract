/* global ethers */

const FacetCutAction = {
    Add: 0,
    Replace: 1,
    Remove: 2
};

// Helper function to get function selectors from ABI
function getSelectors(contract) {
    const signatures = Object.keys(contract.interface.functions);
    const selectors = signatures.reduce((acc, val) => {
        if (val !== 'init(bytes)') {
            acc.push(contract.interface.getSighash(val));
        }
        return acc;
    }, []);
    selectors.contract = contract;
    selectors.remove = remove;
    selectors.get = get;
    return selectors;
}

// Get function selector from function signature
function getSelector(func) {
    const abiInterface = new ethers.utils.Interface([func]);
    return abiInterface.getSighash(ethers.utils.Fragment.from(func));
}

// Used with getSelectors to remove selectors from an array of selectors
// removing a selector from an array of selectors
function remove(funcNames) {
    const selectors = this.filter((v) => {
        for (const funcName of funcNames) {
            if (v === this.contract.interface.getSighash(funcName)) {
                return false;
            }
        }
        return true;
    });
    selectors.contract = this.contract;
    selectors.remove = this.remove;
    selectors.get = this.get;
    return selectors;
}

// Used with getSelectors to get selectors from an array of selectors
// get a selector from an array of selectors
function get(funcNames) {
    const selectors = this.filter((v) => {
        for (const funcName of funcNames) {
            if (v === this.contract.interface.getSighash(funcName)) {
                return true;
            }
        }
        return false;
    });
    selectors.contract = this.contract;
    selectors.remove = this.remove;
    selectors.get = this.get;
    return selectors;
}

// Find a particular address position in the return value of diamondLoupeFacet.facets()
function findAddressPositionInFacets(facetAddress, facets) {
    for (let i = 0; i < facets.length; i++) {
        if (facets[i].facetAddress === facetAddress) {
            return i;
        }
    }
    return -1;
}

exports.getSelectors = getSelectors;
exports.getSelector = getSelector;
exports.FacetCutAction = FacetCutAction;
exports.findAddressPositionInFacets = findAddressPositionInFacets; 
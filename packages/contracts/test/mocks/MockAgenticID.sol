// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgenticID} from "../../src/interfaces/IAgenticID.sol";

/// @dev Mock implementation of IAgenticID for testing.
///      Sequential tokenIds starting at 1, stores owners, tracks mintCount.
contract MockAgenticID is IAgenticID {
    uint256 public mintCount;
    uint256 private _nextTokenId = 1;

    mapping(uint256 => address) private _owners;

    uint256 public constant MINT_FEE = 0.001 ether;

    function mintFee() external pure override returns (uint256) {
        return MINT_FEE;
    }

    function iMint(address to, IntelligentData[] calldata /* datas */)
        external
        payable
        override
        returns (uint256 tokenId)
    {
        tokenId = _nextTokenId++;
        _owners[tokenId] = to;
        mintCount++;
    }

    function ownerOf(uint256 tokenId) external view override returns (address) {
        address owner = _owners[tokenId];
        require(owner != address(0), "MockAgenticID: nonexistent token");
        return owner;
    }

    /// @dev Test helper to simulate NFT transfer.
    function transferOwnership(uint256 tokenId, address newOwner) external {
        require(_owners[tokenId] != address(0), "MockAgenticID: nonexistent token");
        _owners[tokenId] = newOwner;
    }
}

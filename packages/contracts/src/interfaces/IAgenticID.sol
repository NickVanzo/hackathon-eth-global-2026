// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAgenticID {
    struct IntelligentData {
        string dataDescription;
        bytes32 dataHash;
    }
    function iMint(address to, IntelligentData[] calldata datas) external payable returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
    function mintFee() external view returns (uint256);
}

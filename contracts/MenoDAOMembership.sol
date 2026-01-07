// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

/**
 * @title MenoDAO Membership NFT
 * @notice Soulbound-optional membership NFTs for MenoDAO dental care cooperative
 * @dev Supports three tiers: Bronze (1), Silver (2), Gold (3)
 */
contract MenoDAOMembership is ERC721, ERC721Enumerable, ERC721URIStorage, Ownable {
    using Strings for uint256;

    // Tier enum
    enum Tier { None, Bronze, Silver, Gold }

    // Token data
    struct MembershipData {
        Tier tier;
        uint256 mintedAt;
        bool isSoulbound;
    }

    // State variables
    uint256 private _nextTokenId;
    mapping(uint256 => MembershipData) public memberships;
    mapping(address => uint256[]) private _memberTokens;
    
    // Tier metadata
    string public baseExternalUrl = "https://app.menodao.org/nft/";
    
    // Colors for each tier (for on-chain SVG)
    mapping(Tier => string) public tierColors;
    mapping(Tier => string) public tierNames;

    // Events
    event MembershipMinted(address indexed to, uint256 indexed tokenId, Tier tier);
    event MembershipUpgraded(uint256 indexed tokenId, Tier oldTier, Tier newTier);
    event SoulboundStatusChanged(uint256 indexed tokenId, bool isSoulbound);

    constructor() ERC721("MenoDAO Membership", "MENO") Ownable(msg.sender) {
        // Initialize tier colors (dental/health theme)
        tierColors[Tier.Bronze] = "#CD7F32";
        tierColors[Tier.Silver] = "#C0C0C0";
        tierColors[Tier.Gold] = "#FFD700";
        
        // Initialize tier names
        tierNames[Tier.Bronze] = "Bronze";
        tierNames[Tier.Silver] = "Silver";
        tierNames[Tier.Gold] = "Gold";
    }

    /**
     * @notice Mint a new membership NFT
     * @param to Address to mint to
     * @param tier Membership tier (1=Bronze, 2=Silver, 3=Gold)
     */
    function mint(address to, uint256 tier) external onlyOwner returns (uint256) {
        require(tier >= 1 && tier <= 3, "Invalid tier");
        
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        
        memberships[tokenId] = MembershipData({
            tier: Tier(tier),
            mintedAt: block.timestamp,
            isSoulbound: true // Default to soulbound
        });
        
        _memberTokens[to].push(tokenId);
        
        emit MembershipMinted(to, tokenId, Tier(tier));
        
        return tokenId;
    }

    /**
     * @notice Upgrade a membership to a higher tier
     * @param tokenId Token to upgrade
     * @param newTier New tier (must be higher than current)
     */
    function upgradeTier(uint256 tokenId, uint256 newTier) external onlyOwner {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        require(newTier >= 1 && newTier <= 3, "Invalid tier");
        
        Tier currentTier = memberships[tokenId].tier;
        require(uint256(Tier(newTier)) > uint256(currentTier), "Can only upgrade to higher tier");
        
        memberships[tokenId].tier = Tier(newTier);
        
        emit MembershipUpgraded(tokenId, currentTier, Tier(newTier));
    }

    /**
     * @notice Release soulbound status to allow transfer
     * @param tokenId Token to release
     */
    function releaseSoulbound(uint256 tokenId) external onlyOwner {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        memberships[tokenId].isSoulbound = false;
        emit SoulboundStatusChanged(tokenId, false);
    }

    /**
     * @notice Get membership data for a token
     */
    function getMembership(uint256 tokenId) external view returns (
        Tier tier,
        uint256 mintedAt,
        bool isSoulbound,
        address owner
    ) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        MembershipData memory data = memberships[tokenId];
        return (data.tier, data.mintedAt, data.isSoulbound, ownerOf(tokenId));
    }

    /**
     * @notice Get all tokens owned by an address
     */
    function getTokensByOwner(address owner) external view returns (uint256[] memory) {
        uint256 balance = balanceOf(owner);
        uint256[] memory tokens = new uint256[](balance);
        
        for (uint256 i = 0; i < balance; i++) {
            tokens[i] = tokenOfOwnerByIndex(owner, i);
        }
        
        return tokens;
    }

    /**
     * @notice Generate on-chain SVG for the NFT
     */
    function generateSVG(uint256 tokenId) public view returns (string memory) {
        MembershipData memory data = memberships[tokenId];
        string memory tierColor = tierColors[data.tier];
        string memory tierName = tierNames[data.tier];
        
        return string(abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">',
            '<defs>',
            '<linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">',
            '<stop offset="0%" style="stop-color:#1a1a2e"/>',
            '<stop offset="100%" style="stop-color:#16213e"/>',
            '</linearGradient>',
            '</defs>',
            '<rect width="400" height="400" fill="url(#bg)"/>',
            '<circle cx="200" cy="150" r="80" fill="', tierColor, '" opacity="0.9"/>',
            '<text x="200" y="160" font-family="Arial, sans-serif" font-size="40" fill="white" text-anchor="middle" font-weight="bold">',
            unicode'🦷',
            '</text>',
            '<text x="200" y="270" font-family="Arial, sans-serif" font-size="28" fill="white" text-anchor="middle" font-weight="bold">',
            'MenoDAO',
            '</text>',
            '<text x="200" y="310" font-family="Arial, sans-serif" font-size="20" fill="', tierColor, '" text-anchor="middle">',
            tierName, ' Member',
            '</text>',
            '<text x="200" y="370" font-family="Arial, sans-serif" font-size="12" fill="#888" text-anchor="middle">',
            '#', tokenId.toString(),
            '</text>',
            '</svg>'
        ));
    }

    /**
     * @notice Generate token URI with on-chain metadata
     */
    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        
        MembershipData memory data = memberships[tokenId];
        string memory tierName = tierNames[data.tier];
        string memory svg = generateSVG(tokenId);
        
        string memory json = Base64.encode(bytes(string(abi.encodePacked(
            '{"name": "MenoDAO ', tierName, ' Membership #', tokenId.toString(), '",',
            '"description": "MenoDAO Dental Care Cooperative Membership NFT. This NFT grants access to dental care benefits based on membership tier.",',
            '"image": "data:image/svg+xml;base64,', Base64.encode(bytes(svg)), '",',
            '"external_url": "', baseExternalUrl, tokenId.toString(), '",',
            '"attributes": [',
            '{"trait_type": "Tier", "value": "', tierName, '"},',
            '{"trait_type": "Minted", "display_type": "date", "value": ', data.mintedAt.toString(), '},',
            '{"trait_type": "Soulbound", "value": "', data.isSoulbound ? "Yes" : "No", '"}',
            ']}'
        ))));
        
        return string(abi.encodePacked("data:application/json;base64,", json));
    }

    /**
     * @notice Update base external URL
     */
    function setBaseExternalUrl(string memory newUrl) external onlyOwner {
        baseExternalUrl = newUrl;
    }

    // Override transfer to check soulbound status
    function _update(address to, uint256 tokenId, address auth) internal override(ERC721, ERC721Enumerable) returns (address) {
        address from = _ownerOf(tokenId);
        
        // Allow minting (from == address(0)) and burning (to == address(0))
        // Check soulbound status for transfers
        if (from != address(0) && to != address(0)) {
            require(!memberships[tokenId].isSoulbound, "Token is soulbound");
        }
        
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value) internal override(ERC721, ERC721Enumerable) {
        super._increaseBalance(account, value);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC721Enumerable, ERC721URIStorage) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}

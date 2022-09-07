import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { transfer, nestTransfer, addResourceToToken, addResourceEntryFromImpl } from '../utils';
import shouldBehaveLikeNesting from '../behavior/nesting';
import shouldBehaveLikeMultiResource from '../behavior/multiresource';
import shouldControlValidMinting from '../behavior/mintingImpl';
import {
  singleFixtureWithArgs,
  parentChildFixtureWithArgs,
  mintFromImpl,
  nestMintFromImpl,
  ONE_ETH,
} from '../utils';

async function singleFixture(): Promise<{ token: Contract; renderUtils: Contract }> {
  const renderUtilsFactory = await ethers.getContractFactory('RMRKRenderUtils');
  const renderUtils = await renderUtilsFactory.deploy();
  await renderUtils.deployed();

  const token = await singleFixtureWithArgs('RMRKNestingMultiResourceImpl', [
    'NestingMultiResource',
    'NMR',
    10000,
    ONE_ETH,
    'exampleCollectionMetadataIPFSUri',
  ]);
  return { token, renderUtils };
}

async function parentChildFixture(): Promise<{ parent: Contract; child: Contract }> {
  return parentChildFixtureWithArgs(
    'RMRKNestingMultiResourceImpl',
    ['Chunky', 'CHNK', 10000, ONE_ETH, 'exampleCollectionMetadataIPFSUri'],
    ['Monkey', 'MONK', 10000, ONE_ETH, 'exampleCollectionMetadataIPFSUri'],
  );
}

describe('NestingMultiResourceImpl Nesting Behavior', function () {
  beforeEach(async function () {
    const { parent, child } = await loadFixture(parentChildFixture);
    this.parentToken = parent;
    this.childToken = child;
  });

  shouldBehaveLikeNesting(mintFromImpl, nestMintFromImpl, transfer, nestTransfer);
});

describe('NestingMultiResourceImpl MR behavior', async () => {
  beforeEach(async function () {
    const { token, renderUtils } = await loadFixture(singleFixture);
    this.token = token;
    this.renderUtils = renderUtils;
  });

  shouldBehaveLikeMultiResource(mintFromImpl, addResourceEntryFromImpl, addResourceToToken);
});

describe('NestingMultiResourceImpl Other Behavior', function () {
  let addrs: SignerWithAddress[];
  let token: Contract;

  beforeEach(async function () {
    const [, ...signersAddr] = await ethers.getSigners();
    addrs = signersAddr;

    ({ token } = await loadFixture(singleFixture));
    this.parentToken = token;
  });

  describe('Approval Cleaning', async function () {
    it('cleans token and resources approvals on transfer', async function () {
      const tokenOwner = addrs[1];
      const newOwner = addrs[2];
      const approved = addrs[3];
      const tokenId = await mintFromImpl(token, tokenOwner.address);
      await token.connect(tokenOwner).approve(approved.address, tokenId);
      await token.connect(tokenOwner).approveForResources(approved.address, tokenId);

      expect(await token.getApproved(tokenId)).to.eql(approved.address);
      expect(await token.getApprovedForResources(tokenId)).to.eql(approved.address);

      await token.connect(tokenOwner).transfer(newOwner.address, tokenId);

      expect(await token.getApproved(tokenId)).to.eql(ethers.constants.AddressZero);
      expect(await token.getApprovedForResources(tokenId)).to.eql(ethers.constants.AddressZero);
    });

    it('cleans token and resources approvals on burn', async function () {
      const tokenOwner = addrs[1];
      const approved = addrs[3];
      const tokenId = await mintFromImpl(token, tokenOwner.address);
      await token.connect(tokenOwner).approve(approved.address, tokenId);
      await token.connect(tokenOwner).approveForResources(approved.address, tokenId);

      expect(await token.getApproved(tokenId)).to.eql(approved.address);
      expect(await token.getApprovedForResources(tokenId)).to.eql(approved.address);

      await token.connect(tokenOwner).burn(tokenId);

      await expect(token.getApproved(tokenId)).to.be.revertedWithCustomError(
        token,
        'ERC721InvalidTokenId',
      );
      await expect(token.getApprovedForResources(tokenId)).to.be.revertedWithCustomError(
        token,
        'ERC721InvalidTokenId',
      );
    });
  });

  describe('Token URI', async function () {
    let owner: SignerWithAddress;

    before(async function () {
      owner = (await ethers.getSigners())[0];
    });

    it('can set fallback URI', async function () {
      await token.setFallbackURI('TestURI');
      expect(await token.getFallbackURI()).to.be.eql('TestURI');
    });

    it('cannot set fallback URI if not owner', async function () {
      const newFallbackURI = 'NewFallbackURI';
      await expect(
        token.connect(addrs[0]).setFallbackURI(newFallbackURI),
      ).to.be.revertedWithCustomError(token, 'RMRKNotOwner');
    });

    it('return empty string by default', async function () {
      const tokenId = await mintFromImpl(token, owner.address);
      expect(await token.tokenURI(tokenId)).to.be.equal('');
    });

    it('gets fallback URI if no active resources on token', async function () {
      const fallBackUri = 'fallback404';
      const tokenId = await mintFromImpl(token, owner.address);

      await token.setFallbackURI(fallBackUri);
      expect(await token.tokenURI(tokenId)).to.eql(fallBackUri);
    });

    it('can get token URI when resource is not enumerated', async function () {
      const resId = await addResourceEntryFromImpl(token, 'uri1');
      const resId2 = await addResourceEntryFromImpl(token, 'uri2');
      const tokenId = await mintFromImpl(token, owner.address);

      await token.addResourceToToken(tokenId, resId, 0);
      await token.addResourceToToken(tokenId, resId2, 0);
      await token.acceptResource(tokenId, 0);
      await token.acceptResource(tokenId, 0);
      expect(await token.tokenURI(tokenId)).to.eql('uri1');
    });

    it('can get token URI when resource is enumerated', async function () {
      const resId = await addResourceEntryFromImpl(token, 'uri1');
      const resId2 = await addResourceEntryFromImpl(token, 'uri2');
      const tokenId = await mintFromImpl(token, owner.address);

      await token.addResourceToToken(tokenId, resId, 0);
      await token.addResourceToToken(tokenId, resId2, 0);
      await token.acceptResource(tokenId, 0);
      await token.acceptResource(tokenId, 0);
      await token.setTokenEnumeratedResource(resId, true);
      expect(await token.isTokenEnumeratedResource(resId)).to.eql(true);
      expect(await token.tokenURI(tokenId)).to.eql(`uri1${tokenId}`);
    });

    it('can get token URI', async function () {
      const tokenOwner = addrs[1];
      const resId = await addResourceEntryFromImpl(token, 'uri1');
      const resId2 = await addResourceEntryFromImpl(token, 'uri2');
      const tokenId = await mintFromImpl(token, tokenOwner.address);

      await token.addResourceToToken(tokenId, resId, 0);
      await token.addResourceToToken(tokenId, resId2, 0);
      await token.connect(tokenOwner).acceptResource(tokenId, 0);
      await token.connect(tokenOwner).acceptResource(tokenId, 0);
      expect(await token.tokenURI(tokenId)).to.eql('uri1');
    });
  });
});

describe('NestingMultiResourceImpl Minting', async function () {
  beforeEach(async function () {
    const { token } = await loadFixture(singleFixture);
    this.token = token;
  });

  shouldControlValidMinting();
});

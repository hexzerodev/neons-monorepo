import { Auction, AuctionHouseContractFunction } from '../../wrappers/nounsAuction';
import { useContractFunction } from '@usedapp/core';
import { useAppSelector } from '../../hooks';
import React, { useEffect, useState, useRef, ChangeEvent, useCallback } from 'react';
import { utils } from 'ethers';
import BigNumber from 'bignumber.js';
import classes from './Bid.module.css';
import { Spinner, InputGroup, FormControl, Button, Col } from 'react-bootstrap';
import { useAuctionMinBidIncPercentage } from '../../wrappers/nounsAuction';
import { useAppDispatch } from '../../hooks';
import { AlertModal, setAlertModal } from '../../state/slices/application';
import { NounsAuctionHouseFactory } from '@neons/sdk';
import config from '../../config';
import WalletConnectModal from '../WalletConnectModal';
import { Trans } from '@lingui/macro';
import { useActiveLocale } from '../../hooks/useActivateLocale';
import responsiveUiUtilsClasses from '../../utils/ResponsiveUIUtils.module.css';
import { ReactComponent as Canto } from '../../assets/icons/canto.svg';

const computeMinimumNextBid = (
  currentBid: BigNumber,
  minBidIncPercentage: BigNumber | undefined,
): BigNumber => {
  if (!minBidIncPercentage) {
    return new BigNumber(0);
  }
  return currentBid
    .times(minBidIncPercentage.div(100).plus(1))
    .decimalPlaces(0, BigNumber.ROUND_UP);
};

const minBidEth = (minBid: BigNumber): string => {
  if (minBid.isZero()) {
    return '100';
  }

  return new BigNumber(minBid).div(1e18).toFixed(2, BigNumber.ROUND_CEIL);
};

const currentBid = (bidInputRef: React.RefObject<HTMLInputElement>) => {
  if (!bidInputRef.current || !bidInputRef.current.value) {
    return new BigNumber(0);
  }
  return new BigNumber(utils.parseEther(bidInputRef.current.value).toString());
};

const Bid: React.FC<{
  auction: Auction;
  auctionEnded: boolean;
}> = props => {
  const activeAccount = useAppSelector(state => state.account.activeAccount);
  // const { library } = useEthers();
  let { auction, auctionEnded } = props;
  const activeLocale = useActiveLocale();
  const nounsAuctionHouseContract = new NounsAuctionHouseFactory().attach(
    config.addresses.nounsAuctionHouseProxy,
  );

  const account = useAppSelector(state => state.account.activeAccount);

  const bidInputRef = useRef<HTMLInputElement>(null);

  const [bidInput, setBidInput] = useState('');

  const [bidButtonContent, setBidButtonContent] = useState({
    loading: false,
    content: auctionEnded ? <Trans>Settle</Trans> : <Trans>Place bid</Trans>,
  });

  const [showConnectModal, setShowConnectModal] = useState(false);

  const hideModalHandler = () => {
    setShowConnectModal(false);
  };

  const dispatch = useAppDispatch();
  const setModal = useCallback((modal: AlertModal) => dispatch(setAlertModal(modal)), [dispatch]);

  const minBidIncPercentage = useAuctionMinBidIncPercentage();
  const minBid = computeMinimumNextBid(
    auction && new BigNumber(auction.amount.toString()),
    minBidIncPercentage,
  );

  const { send: placeBid, state: placeBidState } = useContractFunction(
    nounsAuctionHouseContract,
    AuctionHouseContractFunction.createBid,
    {
      gasLimitBufferPercentage: 100,
    },
  );
  const { send: settleAuction, state: settleAuctionState } = useContractFunction(
    nounsAuctionHouseContract,
    AuctionHouseContractFunction.settleCurrentAndCreateNewAuction,
    {
      gasLimitBufferPercentage: 50,
    },
  );

  const bidInputHandler = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target.value;

    // disable digits after decimal point
    if (input.includes('.') && event.target.value.split('.')[1].length > 0) {
      return;
    }

    setBidInput(event.target.value);
  };

  const placeBidHandler = async () => {
    if (!auction || !bidInputRef.current || !bidInputRef.current.value) {
      return;
    }

    if (currentBid(bidInputRef).isLessThan(minBid)) {
      setModal({
        show: true,
        title: <Trans>Insufficient bid amount 🤏</Trans>,
        message: (
          <Trans>
            Please place a bid higher than or equal to the minimum bid amount of {minBidEth(minBid)}{' '}
            ETH
          </Trans>
        ),
      });
      setBidInput(minBidEth(minBid));
      return;
    }

    const value = utils.parseEther(bidInputRef.current.value.toString()).toString();
    // const contract = connectContractToSigner(nounsAuctionHouseContract, library);
    // const gasLimit = await contract.estimateGas.createBid(auction.nounId, {
    //   value,
    // });
    placeBid(auction.nounId, {
      value,
      gasLimit: '100000', // gasLimit.add(100_000), // A 10,000 gas pad is used to avoid 'Out of gas' errors
    });
  };

  const settleAuctionHandler = () => {
    settleAuction();
  };

  const clearBidInput = () => {
    if (bidInputRef.current) {
      bidInputRef.current.value = '';
    }
  };

  // successful bid using redux store state
  useEffect(() => {
    if (!account) return;

    // tx state is mining
    const isMiningUserTx = placeBidState.status === 'Mining';
    // allows user to rebid against themselves so long as it is not the same tx
    const isCorrectTx = currentBid(bidInputRef).isEqualTo(new BigNumber(auction.amount.toString()));
    if (isMiningUserTx && auction.bidder === account && isCorrectTx) {
      placeBidState.status = 'Success';
      setModal({
        title: <Trans>Success</Trans>,
        message: <Trans>Bid was placed successfully!</Trans>,
        show: true,
      });
      setBidButtonContent({ loading: false, content: <Trans>Place bid</Trans> });
      clearBidInput();
    }
  }, [auction, placeBidState, account, setModal]);

  // placing bid transaction state hook
  useEffect(() => {
    switch (!auctionEnded && placeBidState.status) {
      case 'None':
        setBidButtonContent({
          loading: false,
          content: <Trans>Place bid</Trans>,
        });
        break;
      case 'Mining':
        setBidButtonContent({ loading: true, content: <></> });
        break;
      case 'Fail':
        setModal({
          title: <Trans>Transaction Failed</Trans>,
          message: placeBidState?.errorMessage || <Trans>Please try again.</Trans>,
          show: true,
        });
        setBidButtonContent({ loading: false, content: <Trans>Bid</Trans> });
        break;
      case 'Exception':
        setModal({
          title: <Trans>Error</Trans>,
          message: placeBidState?.errorMessage || <Trans>Please try again.</Trans>,
          show: true,
        });
        setBidButtonContent({ loading: false, content: <Trans>Bid</Trans> });
        break;
    }
  }, [placeBidState, auctionEnded, setModal]);

  // settle auction transaction state hook
  useEffect(() => {
    switch (auctionEnded && settleAuctionState.status) {
      case 'None':
        setBidButtonContent({
          loading: false,
          content: <Trans>Settle Auction</Trans>,
        });
        break;
      case 'Mining':
        setBidButtonContent({ loading: true, content: <></> });
        break;
      case 'Success':
        setModal({
          title: <Trans>Success</Trans>,
          message: <Trans>Settled auction successfully!</Trans>,
          show: true,
        });
        setBidButtonContent({ loading: false, content: <Trans>Settle Auction</Trans> });
        break;
      case 'Fail':
        setModal({
          title: <Trans>Transaction Failed</Trans>,
          message: settleAuctionState?.errorMessage || <Trans>Please try again.</Trans>,
          show: true,
        });
        setBidButtonContent({ loading: false, content: <Trans>Settle Auction</Trans> });
        break;
      case 'Exception':
        setModal({
          title: <Trans>Error</Trans>,
          message: settleAuctionState?.errorMessage || <Trans>Please try again.</Trans>,
          show: true,
        });
        setBidButtonContent({ loading: false, content: <Trans>Settle Auction</Trans> });
        break;
    }
  }, [settleAuctionState, auctionEnded, setModal]);

  if (!auction) return null;

  const isDisabled =
    placeBidState.status === 'Mining' || settleAuctionState.status === 'Mining' || !activeAccount;

  const isWalletConnected = activeAccount !== undefined;

  return (
    <>
      {showConnectModal && activeAccount === undefined && (
        <WalletConnectModal onDismiss={hideModalHandler} />
      )}
      <InputGroup>
        {!auctionEnded && (
          <>
            <span className={classes.customPlaceholderBidAmt}>
              {!auctionEnded && !bidInput ? (
                <>
                  <Canto style={{ paddingRight: 4, paddingBottom: 2 }} /> {minBidEth(minBid)}{' '}
                  <span
                    className={
                      activeLocale === 'ja-JP' ? responsiveUiUtilsClasses.disableSmallScreens : ''
                    }
                  >
                    <Trans>or more</Trans>
                  </span>
                </>
              ) : (
                ''
              )}
            </span>
            <FormControl
              className={classes.bidInput}
              type="number"
              min="0"
              onChange={bidInputHandler}
              ref={bidInputRef}
              value={bidInput}
            />
          </>
        )}
        {!auctionEnded ? (
          <Button
            className={auctionEnded ? classes.bidBtnAuctionEnded : classes.bidBtn}
            onClick={auctionEnded ? settleAuctionHandler : placeBidHandler}
            disabled={isDisabled}
          >
            {bidButtonContent.loading ? <Spinner animation="border" /> : bidButtonContent.content}
          </Button>
        ) : (
          <>
            {/* Only show force settle button if wallet connected */}
            {isWalletConnected && (
              <Col lg={12} className={classes.voteForNextNounBtnWrapper}>
                <Button className={classes.bidBtnAuctionEnded} onClick={settleAuctionHandler}>
                  <Trans>Settle and start next auction</Trans> ⌐◧-◧
                </Button>
              </Col>
            )}
          </>
        )}
      </InputGroup>
    </>
  );
};
export default Bid;

import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import App from './App';
import { ChainId, DAppProvider, useEthers } from '@usedapp/core';
import { Web3ReactProvider } from '@web3-react/core';
import { Web3Provider } from '@ethersproject/providers';
import account from './state/slices/account';
import application from './state/slices/application';
import logs from './state/slices/logs';
import auction, {
  reduxSafeAuction,
  reduxSafeNewAuction,
  reduxSafeBid,
  setActiveAuction,
  setAuctionExtended,
  setAuctionSettled,
  setFullAuction,
} from './state/slices/auction';
import onDisplayAuction, {
  setLastAuctionNounId,
  setOnDisplayAuctionNounId,
} from './state/slices/onDisplayAuction';
import { ApolloProvider, useQuery } from '@apollo/client';
import { auctionQuery, clientFactory } from './wrappers/subgraph';
import { useEffect } from 'react';
import pastAuctions, { addPastAuctions } from './state/slices/pastAuctions';
import LogsUpdater from './state/updaters/logs';
import config, {
  CANTO_CHAIN_ID,
  CANTO_NETWORK_HTTPS_URL,
  CHAIN_ID,
  createNetworkHttpUrl,
  multicallCanto,
  multicallOnLocalhost,
  SupportedChainIds,
} from './config';
import { BigNumber, BigNumberish } from 'ethers';
import { NounsAuctionHouseFactory } from '@neons/sdk';
import dotenv from 'dotenv';
import { useAppDispatch, useAppSelector } from './hooks';
import { appendBid } from './state/slices/auction';
import { ConnectedRouter, connectRouter } from 'connected-react-router';
import { createBrowserHistory, History } from 'history';
import { applyMiddleware, createStore, combineReducers, PreloadedState } from 'redux';
import { routerMiddleware } from 'connected-react-router';
import { Provider } from 'react-redux';
import { composeWithDevTools } from 'redux-devtools-extension';
import { nounPath } from './utils/history';
import { push } from 'connected-react-router';
import { LanguageProvider } from './i18n/LanguageProvider';

dotenv.config();

export const history = createBrowserHistory();

const createRootReducer = (history: History) =>
  combineReducers({
    router: connectRouter(history),
    account,
    application,
    auction,
    logs,
    pastAuctions,
    onDisplayAuction,
  });

export default function configureStore(preloadedState: PreloadedState<any>) {
  const store = createStore(
    createRootReducer(history), // root reducer with router state
    preloadedState,
    composeWithDevTools(
      applyMiddleware(
        routerMiddleware(history), // for dispatching history actions
        // ... other middlewares ...
      ),
    ),
  );

  return store;
}

const store = configureStore({});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

const supportedChainURLs = {
  [CANTO_CHAIN_ID]: CANTO_NETWORK_HTTPS_URL,
  [ChainId.Goerli]: createNetworkHttpUrl('goerli'),
};

// prettier-ignore
const useDappConfig = {
  readOnlyChainId: CHAIN_ID,
  readOnlyUrls: {
    [ChainId.Mainnet]: createNetworkHttpUrl('mainnet'),
    [CHAIN_ID]: supportedChainURLs[CHAIN_ID],
  },
  multicallAddresses: {
    [CANTO_CHAIN_ID]: multicallCanto,
    [ChainId.Hardhat]: multicallOnLocalhost,
  }
};

const client = clientFactory(config.app.subgraphApiUri);

const Updaters = () => {
  return (
    <>
      <LogsUpdater />
    </>
  );
};

const LAST_AUCTION_BLOCK = 100;

const ChainSubscriber: React.FC = () => {
  const { library, activateBrowserWallet } = useEthers();
  const dispatch = useAppDispatch();

  useEffect(() => {
    const loadState = async () => {
      try {
        const network = await library?.getNetwork();

        if (!library || !SupportedChainIds.includes(network?.chainId ?? 1)) {
          await activateBrowserWallet();
          return console.error('no library');
        }
      } catch {
        return console.error('no library');
      }

      const nounsAuctionHouseContract = NounsAuctionHouseFactory.connect(
        config.addresses.nounsAuctionHouseProxy,
        library,
      );

      const bidFilter = nounsAuctionHouseContract.filters.AuctionBid(null, null, null, null);
      const extendedFilter = nounsAuctionHouseContract.filters.AuctionExtended(null, null);
      const createdFilter = nounsAuctionHouseContract.filters.AuctionCreated(null, null, null);
      const settledFilter = nounsAuctionHouseContract.filters.AuctionSettled(null, null, null);
      const processBidFilter = async (
        nounId: BigNumberish,
        sender: string,
        value: BigNumberish,
        extended: boolean,
        event: any,
      ) => {
        const timestamp = (await event.getBlock()).timestamp;
        const transactionHash = event.transactionHash;
        dispatch(
          appendBid(reduxSafeBid({ nounId, sender, value, extended, transactionHash, timestamp })),
        );
      };
      const processAuctionCreated = (
        nounId: BigNumberish,
        startTime: BigNumberish,
        endTime: BigNumberish,
      ) => {
        dispatch(
          setActiveAuction(reduxSafeNewAuction({ nounId, startTime, endTime, settled: false })),
        );
        const nounIdNumber = BigNumber.from(nounId).toNumber();
        dispatch(push(nounPath(nounIdNumber)));
        dispatch(setOnDisplayAuctionNounId(nounIdNumber));
        dispatch(setLastAuctionNounId(nounIdNumber));
      };
      const processAuctionExtended = (nounId: BigNumberish, endTime: BigNumberish) => {
        dispatch(setAuctionExtended({ nounId, endTime }));
      };
      const processAuctionSettled = (
        nounId: BigNumberish,
        winner: string,
        amount: BigNumberish,
      ) => {
        dispatch(setAuctionSettled({ nounId, amount, winner }));
      };

      // Fetch the current auction
      const currentAuction = await nounsAuctionHouseContract.auction();
      dispatch(setFullAuction(reduxSafeAuction(currentAuction)));
      dispatch(setLastAuctionNounId(currentAuction.nounId.toNumber()));

      // Fetch the previous 24 hours of bids
      const previousBids = await nounsAuctionHouseContract.queryFilter(
        bidFilter,
        0 - LAST_AUCTION_BLOCK,
      );
      for (let event of previousBids) {
        if (event.args === undefined) return;
        processBidFilter(...(event.args as [BigNumber, string, BigNumber, boolean]), event);
      }

      nounsAuctionHouseContract.on(bidFilter, (nounId, sender, value, extended, event) =>
        processBidFilter(nounId, sender, value, extended, event),
      );
      nounsAuctionHouseContract.on(createdFilter, (nounId, startTime, endTime) =>
        processAuctionCreated(nounId, startTime, endTime),
      );
      nounsAuctionHouseContract.on(extendedFilter, (nounId, endTime) =>
        processAuctionExtended(nounId, endTime),
      );
      nounsAuctionHouseContract.on(settledFilter, (nounId, winner, amount) =>
        processAuctionSettled(nounId, winner, amount),
      );
    };

    loadState();
  }, [library, activateBrowserWallet, dispatch]);

  return <></>;
};

/**
 * I can't understand why fetch last 1000 items then find by id
 * why not just fetch 1 item
 */
const PastAuctions: React.FC = () => {
  const onDisplayAuctionNounId =
    useAppSelector(state => state.onDisplayAuction.onDisplayAuctionNounId) ?? 0;
  const { data } = useQuery(auctionQuery(onDisplayAuctionNounId));
  const dispatch = useAppDispatch();

  useEffect(() => {
    data && dispatch(addPastAuctions({ data }));
  }, [data, onDisplayAuctionNounId, dispatch]);

  return <></>;
};

ReactDOM.render(
  <Provider store={store}>
    <ConnectedRouter history={history}>
      <React.StrictMode>
        <Web3ReactProvider
          getLibrary={
            provider => new Web3Provider(provider) // this will vary according to whether you use e.g. ethers or web3.js
          }
        >
          <ApolloProvider client={client}>
            <PastAuctions />
            <DAppProvider config={useDappConfig}>
              <ChainSubscriber />
              <LanguageProvider>
                <App />
              </LanguageProvider>
              <Updaters />
            </DAppProvider>
          </ApolloProvider>
        </Web3ReactProvider>
      </React.StrictMode>
    </ConnectedRouter>
  </Provider>,
  document.getElementById('root'),
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
// reportWebVitals();

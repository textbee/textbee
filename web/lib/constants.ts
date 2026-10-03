export const OPEN_SEARCH_EVENT = 'textbee:open-search'

export const WEBHOOK_EVENTS = {
  MESSAGE_RECEIVED: 'MESSAGE_RECEIVED',
} as const

export const CRYPTO_ADDRESSES = [
  {
    name: 'Bitcoin (BTC)',
    address: 'bc1q3zt8fc48psqqlranlkn68rf5mzuyuh7vd62vs3',
    network: 'Bitcoin',
    icon: '/crypto/btc.svg',
  },
  {
    name: 'Ethereum (ETH)',
    address: '0x568541d7d566eB064D1e8bCd83843bF3970B92c1',
    network: 'Ethereum',
    icon: '/crypto/eth.svg',
  },
  {
    name: 'Tether (USDT)',
    address: '0x568541d7d566eB064D1e8bCd83843bF3970B92c1',
    network: 'Ethereum (ERC-20)',
    icon: '/crypto/usdt.svg',
  },
  {
    name: 'Solana (SOL)',
    address: 'C6puH6rD6D7BgbRt8NPpkD62fMnPGQvYUKDiA1eUUjGZ',
    network: 'Solana',
    icon: '/crypto/sol.svg',
  },
  {
    name: 'Monero (XMR)',
    address:
      '856J5eHJM7bgBhkc51oCuMYUGKvUvF1zwAWrQsqwuH1shG9qnX4YkoZbMmhCPep1JragY2W1hpzAnDda6BXvCgZxUJhUyTg',
    network: 'Monero',
    icon: '/crypto/xmr.svg',
  },
]

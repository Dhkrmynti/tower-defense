export const PONS_V2_CONFIG = {
  chainId: 4663,
  chainName: 'Robinhood Chain',
  currency: 'ETH',
  contracts: {
    token: import.meta.env.VITE_TOKEN_ADDRESS || '',
    curve: import.meta.env.VITE_CURVE_ADDRESS || '',
    creator: import.meta.env.VITE_CREATOR_ADDRESS || '',
    factory: '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e',
    feeEscrow: '0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e',
    buybackVault: '0x42df2a798f82289E177311362e8f5ccC45c1219c',
    memeHook: '0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044',
    launchLocker: '0x267444D099b10fB5Ed7c3Cc7B7c767AdcA574952',
    deadAddress: '0x000000000000000000000000000000000000dEaD',
    uniswapV4Router: import.meta.env.VITE_UNISWAP_ROUTER_ADDRESS || '0x8876789976dEcBfCbBbe364623C63652db8C0904'
  }
};

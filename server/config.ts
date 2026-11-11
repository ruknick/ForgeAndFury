import 'dotenv/config';

const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));

export const config = {
  port: Number(process.env.PORT ?? 8787),
  dataFile: process.env.DATA_FILE ?? 'server/data/db.json',
  xrplNetwork: process.env.XRPL_NETWORK ?? 'wss://s.altnet.rippletest.net:51233',
  xrplExplorer: process.env.XRPL_EXPLORER ?? 'https://testnet.xrpl.org',
  issuerSeed: process.env.XRPL_ISSUER_SEED ?? '',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 8787}`).replace(/\/$/, ''),
  transferFee: Number(process.env.XRPL_TRANSFER_FEE ?? 5000),
  enableNftDeposit: bool(process.env.ENABLE_NFT_DEPOSIT, true),
  maxRelicsPerLevel: Number(process.env.MAX_RELICS_PER_LEVEL ?? 3),
};

export type Config = typeof config;

if (/mainnet|s1\.ripple\.com|s2\.ripple\.com|xrplcluster/i.test(config.xrplNetwork)) {
  throw new Error('Relic Clash prototype is Testnet-only. Refusing to start against a Mainnet endpoint.');
}

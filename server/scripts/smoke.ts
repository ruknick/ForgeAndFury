/**
 * npm run xrpl:smoke — end-to-end on Testnet (spec §8.6):
 * mint a Sword to player A → A sends it to player B → B deposits → game burns it.
 * Uses the issuer from .env if present, otherwise funds a throwaway issuer.
 */
import { config } from '../config';
import { relicDef } from '../../shared/relics';
import { XrplService } from '../xrpl';

const temp = !config.issuerSeed;
const xrpl0 = new XrplService(config);
const issuerSeed = config.issuerSeed || (await xrpl0.fundNewWallet()).seed!;
await xrpl0.disconnect();
const xrpl = new XrplService({ ...config, issuerSeed });

const step = (s: string) => console.log(`\n▶ ${s}`);
const txs = (h: string[]) => h.forEach((x) => console.log(`   ${xrpl.explorerTx(x)}`));
try {
  console.log(`Network: ${config.xrplNetwork}`);
  console.log(`Issuer: ${xrpl.issuer().address}${temp ? ' (temporary)' : ''}`);
  step('Funding player wallets A and B');
  const [a, b] = await Promise.all([xrpl.fundNewWallet(), xrpl.fundNewWallet()]);
  console.log(`   A ${a.address}\n   B ${b.address}`);

  step('Minting a Sword to A');
  const sword = relicDef('sword');
  const { nftokenId, hashes } = await xrpl.mintToPlayer(sword, a);
  txs(hashes);
  console.log(`   NFT ${xrpl.explorerNft(nftokenId)}`);
  const inA = await xrpl.listGameNfts(a.address);
  if (!inA.some((n) => n.nftokenId === nftokenId && n.relicId === 'sword')) throw new Error('Sword not found in A');

  step('A transfers the Sword to B');
  txs(await xrpl.transfer(a, b, nftokenId));
  if (!(await xrpl.listGameNfts(b.address)).some((n) => n.nftokenId === nftokenId)) throw new Error('Sword not found in B');

  step('B deposits the Sword (game accepts and burns it)');
  txs(await xrpl.depositAndBurn(b, nftokenId));
  if ((await xrpl.listGameNfts(b.address)).length) throw new Error('B still holds a game NFT');
  if ((await xrpl.listGameNfts(xrpl.issuer().address)).some((n) => n.nftokenId === nftokenId)) throw new Error('NFT not burned');

  console.log('\n✅ xrpl:smoke passed');
} catch (e) {
  console.error('\n❌ xrpl:smoke failed:', e);
  process.exitCode = 1;
} finally {
  await xrpl.disconnect();
}

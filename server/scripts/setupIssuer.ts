/**
 * Creates and funds the game's Testnet issuer account and writes its seed to .env.
 * Safe to re-run: if XRPL_ISSUER_SEED is already set it just reports the balance.
 */
import fs from 'node:fs';
import { config } from '../config';
import { XrplService } from '../xrpl';

const xrpl = new XrplService(config);
try {
  if (config.issuerSeed) {
    const addr = xrpl.issuer().address;
    console.log(`Issuer already configured: ${addr}`);
    console.log(`Balance: ${await xrpl.balance(addr)} XRP  ${xrpl.explorerAccount(addr)}`);
  } else {
    console.log(`Funding a new issuer from the Testnet faucet (${config.xrplNetwork})...`);
    const w = await xrpl.fundNewWallet();
    const envPath = '.env';
    let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : fs.readFileSync('.env.example', 'utf8');
    env = /^XRPL_ISSUER_SEED=.*$/m.test(env) ? env.replace(/^XRPL_ISSUER_SEED=.*$/m, `XRPL_ISSUER_SEED=${w.seed}`) : `${env}\nXRPL_ISSUER_SEED=${w.seed}\n`;
    fs.writeFileSync(envPath, env);
    console.log(`Issuer: ${w.address}`);
    console.log(`Seed written to .env (never commit it).`);
    console.log(xrpl.explorerAccount(w.address));
  }
  const r = await xrpl.reserves();
  console.log(`Current reserves: base ${r.baseXrp} XRP, owner increment ${r.ownerXrp} XRP`);
} finally {
  await xrpl.disconnect();
}

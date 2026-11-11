import { createApp } from './app';
import { config } from './config';
import { Store } from './store';
import { XrplService } from './xrpl';

const store = new Store(config.dataFile);
const xrpl = new XrplService(config);
const app = createApp(config, store, xrpl);

app.listen(config.port, () => {
  console.log(`Relic Clash server on http://localhost:${config.port}`);
  console.log(`XRPL: ${xrpl.configured ? `issuer ${xrpl.issuer().address} on ${config.xrplNetwork}` : 'not configured (run npm run xrpl:setup)'}`);
  console.log(`NFT deposit: ${config.enableNftDeposit ? 'enabled' : 'disabled'}`);
});

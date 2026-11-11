/**
 * Optional outbound proxy support. Only active when HTTPS_PROXY is set
 * (corporate networks, sandboxed CI). xrpl.js opens a raw WebSocket and the
 * faucet uses fetch; neither honors HTTPS_PROXY on its own.
 */
import { HttpsProxyAgent } from 'https-proxy-agent';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

export const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy || '';

if (httpsProxy) setGlobalDispatcher(new EnvHttpProxyAgent());

export function wsAgent(): HttpsProxyAgent<string> | undefined {
  return httpsProxy ? new HttpsProxyAgent(httpsProxy) : undefined;
}

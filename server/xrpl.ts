/**
 * All XRPL calls live here (spec §8.6): the client never sees a seed.
 * Testnet only. Every method returns the tx hashes it produced so callers can
 * log them on the inventory row.
 */
import {
  Client, Wallet, convertStringToHex, getNFTokenID, NFTokenCreateOfferFlags, NFTokenMintFlags,
  type SubmittableTransaction, type TransactionMetadata,
} from 'xrpl';
import type { Config } from './config';
import { relicByTaxon } from '../shared/relics';
import type { RelicDef } from '../shared/types';

export interface ChainNft {
  nftokenId: string;
  taxon: number;
  issuer: string;
  uri?: string;
  relicId?: string;
}

export class XrplError extends Error {
  constructor(message: string, readonly hashes: string[] = []) {
    super(message);
  }
}

export class XrplService {
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;

  constructor(private cfg: Config) {}

  get configured() {
    return !!this.cfg.issuerSeed;
  }

  issuer(): Wallet {
    if (!this.cfg.issuerSeed) throw new XrplError('XRPL issuer not configured. Run `npm run xrpl:setup`.');
    return Wallet.fromSeed(this.cfg.issuerSeed);
  }

  async conn(): Promise<Client> {
    if (this.client?.isConnected()) return this.client;
    if (!this.connecting) {
      this.connecting = (async () => {
        const c = new Client(this.cfg.xrplNetwork, { connectionTimeout: 15000 });
        await c.connect();
        this.client = c;
        return c;
      })().finally(() => (this.connecting = null));
    }
    return this.connecting;
  }

  async disconnect() {
    await this.client?.disconnect();
    this.client = null;
  }

  explorerTx(hash: string) {
    return `${this.cfg.xrplExplorer}/transactions/${hash}`;
  }
  explorerNft(id: string) {
    return `${this.cfg.xrplExplorer}/nft/${id}`;
  }
  explorerAccount(address: string) {
    return `${this.cfg.xrplExplorer}/accounts/${address}`;
  }

  /** Generates and funds a fresh Testnet wallet from the faucet. */
  async fundNewWallet(): Promise<Wallet> {
    const c = await this.conn();
    const { wallet } = await c.fundWallet();
    return wallet;
  }

  /** Current reserves, read from the network rather than hard-coded (spec §8.6). */
  async reserves(): Promise<{ baseXrp: number; ownerXrp: number }> {
    const c = await this.conn();
    const info = await c.request({ command: 'server_info' });
    const l = info.result.info.validated_ledger;
    return { baseXrp: l?.reserve_base_xrp ?? NaN, ownerXrp: l?.reserve_inc_xrp ?? NaN };
  }

  async balance(address: string): Promise<number | null> {
    try {
      return await (await this.conn()).getXrpBalance(address);
    } catch {
      return null; // unfunded / not found
    }
  }

  /** NFTs in `address` that were minted by the game issuer and map to a known relic. */
  async listGameNfts(address: string): Promise<ChainNft[]> {
    const c = await this.conn();
    const issuer = this.issuer().address;
    const out: ChainNft[] = [];
    let marker: unknown;
    do {
      const res = await c.request({ command: 'account_nfts', account: address, limit: 400, marker });
      for (const n of res.result.account_nfts) {
        if (n.Issuer !== issuer) continue;
        out.push({ nftokenId: n.NFTokenID, taxon: n.NFTokenTaxon, issuer: n.Issuer, uri: n.URI, relicId: relicByTaxon(n.NFTokenTaxon)?.id });
      }
      marker = res.result.marker;
    } while (marker);
    return out;
  }

  private async submit(tx: SubmittableTransaction, wallet: Wallet, hashes: string[]) {
    const c = await this.conn();
    const res = await c.submitAndWait(tx, { wallet, autofill: true });
    const meta = res.result.meta as TransactionMetadata;
    hashes.push(res.result.hash);
    const code = typeof meta === 'object' ? meta.TransactionResult : 'unknown';
    if (code !== 'tesSUCCESS') throw new XrplError(`${tx.TransactionType} failed: ${code}`, hashes);
    return meta;
  }

  private offerIdFrom(meta: TransactionMetadata): string {
    const direct = (meta as unknown as { offer_id?: string }).offer_id;
    if (direct) return direct;
    for (const node of meta.AffectedNodes) {
      if ('CreatedNode' in node && node.CreatedNode.LedgerEntryType === 'NFTokenOffer') return node.CreatedNode.LedgerIndex;
    }
    throw new XrplError('Could not find created NFTokenOffer in metadata');
  }

  /** Sell offer for 0 XRP, only acceptable by `destination`. */
  async createFreeTransferOffer(from: Wallet, nftokenId: string, destination: string, hashes: string[]): Promise<string> {
    const meta = await this.submit(
      { TransactionType: 'NFTokenCreateOffer', Account: from.address, NFTokenID: nftokenId, Amount: '0', Flags: NFTokenCreateOfferFlags.tfSellNFToken, Destination: destination },
      from,
      hashes,
    );
    return this.offerIdFrom(meta);
  }

  async acceptSellOffer(by: Wallet, offerId: string, hashes: string[]) {
    await this.submit({ TransactionType: 'NFTokenAcceptOffer', Account: by.address, NFTokenSellOffer: offerId }, by, hashes);
  }

  metadataUri(relic: RelicDef) {
    return `${this.cfg.publicBaseUrl}/api/metadata/${relic.id}.json`;
  }

  /** Spec §8.3: mint by issuer → 0-XRP offer to player → player accepts (server-held dev wallet). */
  async mintToPlayer(relic: RelicDef, player: Wallet): Promise<{ nftokenId: string; hashes: string[] }> {
    const issuer = this.issuer();
    const hashes: string[] = [];
    const meta = await this.submit(
      {
        TransactionType: 'NFTokenMint',
        Account: issuer.address,
        NFTokenTaxon: relic.taxon,
        Flags: NFTokenMintFlags.tfTransferable | NFTokenMintFlags.tfBurnable,
        TransferFee: this.cfg.transferFee,
        URI: convertStringToHex(this.metadataUri(relic)),
      },
      issuer,
      hashes,
    );
    const nftokenId = (meta as unknown as { nftoken_id?: string }).nftoken_id ?? getNFTokenID(meta);
    if (!nftokenId) throw new XrplError('Mint succeeded but NFTokenID not found', hashes);
    try {
      const offerId = await this.createFreeTransferOffer(issuer, nftokenId, player.address, hashes);
      await this.acceptSellOffer(player, offerId, hashes);
    } catch (e) {
      // The NFT exists but is still with the issuer: burn it so supply stays honest.
      await this.submit({ TransactionType: 'NFTokenBurn', Account: issuer.address, NFTokenID: nftokenId }, issuer, hashes).catch(() => {});
      throw new XrplError(`Transfer to player failed: ${(e as Error).message}`, hashes);
    }
    return { nftokenId, hashes };
  }

  /** Wallet-to-wallet transfer (both server-held), i.e. "trading" for the demo. */
  async transfer(from: Wallet, to: Wallet, nftokenId: string): Promise<string[]> {
    const hashes: string[] = [];
    const offerId = await this.createFreeTransferOffer(from, nftokenId, to.address, hashes);
    await this.acceptSellOffer(to, offerId, hashes);
    return hashes;
  }

  /** Spec §8.4: player offers to game for 0 XRP → game accepts → game burns. */
  async depositAndBurn(from: Wallet, nftokenId: string): Promise<string[]> {
    const issuer = this.issuer();
    const hashes: string[] = [];
    const offerId = await this.createFreeTransferOffer(from, nftokenId, issuer.address, hashes);
    await this.acceptSellOffer(issuer, offerId, hashes);
    await this.submit({ TransactionType: 'NFTokenBurn', Account: issuer.address, NFTokenID: nftokenId }, issuer, hashes);
    return hashes;
  }
}

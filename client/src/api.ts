import type { Action, PlacedBurial } from '../../shared/game';
import type { Rarity, RelicDef, RelicInstance } from '../../shared/types';

export type OwnedRelic = RelicInstance & { def: RelicDef };

export interface PlayerInfo {
  id: string;
  name: string;
  walletAddress: string | null;
  progress: Record<string, { stars: number; bestScore: number }>;
}

export interface ServerConfig {
  relics: RelicDef[];
  dropTable: Record<Rarity, number>;
  levels: { id: number; name: string; dropTable: Record<Rarity, number> }[];
  flags: { demo?: boolean; devGrant: boolean; enableNftDeposit: boolean; xrplConfigured: boolean; maxRelicsPerLevel: number };
  network: { endpoint: string; explorer: string; issuer: string | null };
}

export interface SessionInfo {
  sessionId: string;
  levelId: number;
  seed: number;
  burials: PlacedBurial[];
  maxRelics: number;
}

export interface WalletNft {
  nftokenId: string;
  taxon: number;
  relicId?: string;
  def: RelicDef | null;
  explorer: string;
}

export interface WalletInfo {
  configured: boolean;
  address?: string | null;
  explorer?: string;
  balance?: number | null;
  reserves?: { baseXrp: number; ownerXrp: number } | null;
  nfts?: WalletNft[];
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** True for the static demo build (VITE_DEMO=1), where a stand-in server runs in the browser. */
export const DEMO = import.meta.env.VITE_DEMO === '1';

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (DEMO) {
    const { demoHandle, DemoError } = await import('./demoServer');
    try {
      return demoHandle(method, path, body) as T;
    } catch (e) {
      if (e instanceof DemoError) throw new ApiError(e.status, e.message);
      throw e;
    }
  }
  let res: Response;
  try {
    res = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, 'Cannot reach the game server');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`);
  return data as T;
}

const PLAYER_KEY = 'relic-clash.player';

export const api = {
  config: () => call<ServerConfig>('GET', '/api/config'),
  players: () => call<PlayerInfo[]>('GET', '/api/players'),
  createPlayer: (name?: string) => call<PlayerInfo>('POST', '/api/players', { name }),
  player: (id: string) => call<PlayerInfo>('GET', `/api/players/${id}`),
  inventory: (id: string) => call<{ relics: OwnedRelic[] }>('GET', `/api/players/${id}/inventory`),
  startSession: (playerId: string, levelId: number) => call<SessionInfo>('POST', '/api/sessions', { playerId, levelId }),
  reveal: (sessionId: string, burialId: string, log: Action[]) => call<{ relic: OwnedRelic }>('POST', `/api/sessions/${sessionId}/reveal`, { burialId, log }),
  useRelic: (sessionId: string, instanceId: string) => call<{ relic: OwnedRelic }>('POST', `/api/sessions/${sessionId}/use`, { instanceId }),
  finish: (sessionId: string, log: Action[]) => call<{ status: string; score: number; stars: number }>('POST', `/api/sessions/${sessionId}/finish`, { log }),
  wallet: (id: string) => call<WalletInfo>('GET', `/api/players/${id}/wallet`),
  createWallet: (id: string) => call<{ address: string }>('POST', `/api/players/${id}/wallet`),
  mint: (instanceId: string, playerId: string) => call<{ relic: OwnedRelic; explorer: string; txs: string[] }>('POST', `/api/relics/${instanceId}/mint`, { playerId }),
  deposit: (playerId: string, nftokenId: string) => call<{ relic: OwnedRelic; txs: string[] }>('POST', `/api/players/${playerId}/deposit`, { nftokenId }),
  transfer: (playerId: string, nftokenId: string, to: { toPlayerId?: string; toAddress?: string }) =>
    call<{ txs?: string[]; offerId?: string; note?: string }>('POST', `/api/players/${playerId}/transfer`, { nftokenId, ...to }),
  devGrant: (playerId: string, relicId: string) => call<{ relic: OwnedRelic }>('POST', '/api/dev/grant', { playerId, relicId }),
  stats: () => call<{ minted: Record<string, number>; burned: Record<string, number>; found: Record<string, number> }>('GET', '/api/stats'),

  get playerId(): string | null {
    try {
      return localStorage.getItem(PLAYER_KEY);
    } catch {
      return null;
    }
  },
  set playerId(id: string | null) {
    try {
      if (id) localStorage.setItem(PLAYER_KEY, id);
      else localStorage.removeItem(PLAYER_KEY);
    } catch {
      /* private mode: fine, we just won't remember */
    }
  },
};

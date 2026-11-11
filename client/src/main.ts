import Phaser from 'phaser';
import { getLevel, LEVELS } from '../../shared/levels';
import { RARITIES, RARITY_INFO } from '../../shared/relics';
import { isMuted, setMuted, unlockAudio } from './audio';
import { api, type OwnedRelic, type PlayerInfo, type ServerConfig } from './api';
import { BoardScene, CELL } from './game/BoardScene';
import { LevelController, type LevelOutcome } from './game/LevelController';
import { $, h, rarityCss, showModal, showScreen, starsHtml, toast } from './ui';
import './style.css';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'board',
  width: 8 * CELL,
  height: 8 * CELL,
  transparent: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [],
  input: { activePointers: 1 },
  render: { antialias: true },
});
game.scene.add('board', BoardScene, false);

document.addEventListener('pointerdown', unlockAudio, { once: true });
const muteBtn = $('btn-mute');
const paintMute = () => (muteBtn.textContent = isMuted() ? '🔇' : '🔊');
muteBtn.onclick = () => {
  setMuted(!isMuted());
  paintMute();
};
paintMute();

let cfg: ServerConfig | null = null;
let me: PlayerInfo | null = null;

async function boot() {
  try {
    cfg = await api.config();
    const saved = api.playerId;
    me = saved ? await api.player(saved).catch(() => null) : null;
    if (!me) {
      me = await api.createPlayer();
      api.playerId = me.id;
    }
  } catch (e) {
    toast(`Game server unreachable (${(e as Error).message}). You can still play, but relics are disabled.`, 'error', 6000);
  }
  await menu();
}

async function refreshMe() {
  if (me) me = await api.player(me.id).catch(() => me);
}

// ---------------------------------------------------------------- menu

async function menu() {
  await refreshMe();
  $('board').hidden = true;
  const progress = me?.progress ?? {};
  showScreen(
    h('div', { class: 'screen-inner' },
      h('h1', { class: 'title' }, 'Relic Clash'),
      h('div', { class: 'subtitle' }, 'Match. Unearth. Wield the relics of old.'),
      h('div', { class: 'panel' },
        h('h2', {}, '⚔️ Campaign'),
        h('div', { class: 'levels' },
          ...LEVELS.map((l) =>
            h('button', { class: 'level-card', onclick: () => playLevel(l.id) },
              h('div', { class: 'num' }, l.id),
              h('div', { class: 'info' }, h('div', { class: 'name' }, l.name), h('div', { class: 'muted small' }, objectiveText(l.id))),
              h('div', { class: 'stars' }, starsHtml(progress[l.id]?.stars ?? 0)))),
          h('button', { class: 'level-card', onclick: () => playLevel(0) },
            h('div', { class: 'num' }, '∞'),
            h('div', { class: 'info' }, h('div', { class: 'name' }, 'Endless Training'), h('div', { class: 'muted small' }, 'No goal, no limit. Practice your swaps.'))))),
      h('div', { class: 'row', style: 'justify-content:center' },
        h('button', { class: 'btn', onclick: () => armory() }, '🛡️ Armory'),
        h('button', { class: 'btn secondary', onclick: () => rates() }, '🎲 Drop rates')),
      h('div', { class: 'muted small', style: 'text-align:center' },
        me ? `Playing as ${me.name}` : 'Offline mode',
        cfg && !cfg.flags.xrplConfigured ? ' · XRPL not configured' : '',
        cfg?.flags.xrplConfigured ? ' · XRPL Testnet' : '')),
  );
}

function objectiveText(id: number) {
  const l = getLevel(id)!;
  const o = l.objective;
  if (o.type === 'collect') return 'Collect ' + (o.targets ?? [{ tile: o.tile!, count: o.count! }]).map((t) => `${t.count} ${t.tile}`).join(' & ');
  if (o.type === 'score') return `Score ${o.score.toLocaleString()}`;
  if (o.type === 'fortress') return `Smash ${l.walls?.length ?? 0} palisade walls`;
  return 'Unearth every relic';
}

// ---------------------------------------------------------------- levels

async function playLevel(id: number) {
  const level = getLevel(id)!;
  showScreen(null);
  if (level.intro) {
    await showModal((close) =>
      h('div', { class: 'card' },
        h('div', { class: 'muted small' }, id ? `Level ${id}` : 'Sandbox'),
        h('h1', {}, level.name),
        h('p', {}, level.intro),
        h('div', { class: 'muted small' }, `${level.moves > 999 ? 'Unlimited' : level.moves} moves · up to ${cfg?.flags.maxRelicsPerLevel ?? 3} relics`),
        h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => close() }, 'To battle!'))));
  }
  const ctrl = new LevelController(game, level, me?.id ?? null);
  if (import.meta.env.DEV) (window as unknown as { __ctrl: LevelController }).__ctrl = ctrl; // for automated play-testing
  const outcome = await ctrl.start();
  if (outcome.status === 'quit') return menu();
  await results(id, outcome);
}

async function results(id: number, o: LevelOutcome) {
  const won = o.status === 'won';
  const next = getLevel(id + 1) && id > 0 ? id + 1 : null;
  const action = await showModal((close) =>
    h('div', { class: 'card', style: won ? '' : '--rc:#e2553a' },
      h('h1', {}, won ? 'Victory!' : 'Defeated'),
      h('div', { class: 'stars-big' }, starsHtml(o.stars)),
      h('div', {}, `Score: ${o.score.toLocaleString()}`),
      o.found.length
        ? h('div', {}, h('div', { class: 'muted small' }, 'Relics found'), h('div', { class: 'found' }, ...o.found.map((r) => h('span', { style: `--rc:${rarityCss(r.def.rarity)}`, title: r.def.name }, r.def.glyph))))
        : h('div', { class: 'muted small' }, 'No relics found this time.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn secondary', onclick: () => close('menu') }, 'Menu'),
        h('button', { class: 'btn secondary', onclick: () => close('retry') }, 'Retry'),
        won && next ? h('button', { class: 'btn', onclick: () => close('next') }, 'Next level ▶') : null)));
  if (action === 'retry') return playLevel(id);
  if (action === 'next' && next) return playLevel(next);
  return menu();
}

// ---------------------------------------------------------------- drop rates (spec §12: publish them)

function rates() {
  if (!cfg) return toast('Server offline', 'error');
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  showModal((close) =>
    h('div', { class: 'card' },
      h('h1', {}, 'Drop rates'),
      h('p', { class: 'muted small' }, 'Every buried relic is rolled on the game server with these published odds.'),
      h('table', { class: 'rates' },
        h('tr', {}, h('th', {}, 'Rarity'), h('th', {}, 'Default'), h('th', {}, "Warlord's Keep")),
        ...RARITIES.map((r) => h('tr', {},
          h('td', { class: `r-${r}` }, RARITY_INFO[r].name),
          h('td', { class: 'n' }, pct(cfg!.dropTable[r])),
          h('td', { class: 'n' }, pct(cfg!.levels.find((l) => l.id === 5)?.dropTable[r] ?? cfg!.dropTable[r]))))),
      h('table', { class: 'rates' },
        ...cfg!.relics.map((d) => h('tr', {}, h('td', {}, d.glyph), h('td', { class: `r-${d.rarity}` }, d.name), h('td', { class: 'muted small' }, d.effectText)))),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => close() }, 'Close'))));
}

// ---------------------------------------------------------------- armory (M4)

async function armory() {
  if (!me || !cfg) return toast('The Armory needs the game server.', 'error');
  const body = h('div', { class: 'screen-inner' }, h('h1', { class: 'title', style: 'font-size:2.2rem' }, 'Armory'), h('div', { class: 'muted', style: 'text-align:center' }, 'Loading…'));
  showScreen(body);
  const [players, inv, wallet, stats] = await Promise.all([
    api.players(),
    api.inventory(me.id),
    api.wallet(me.id).catch((e: Error) => ({ configured: true, error: e.message }) as const),
    api.stats(),
  ]);
  const explorer = cfg.network.explorer;
  const busyBtn = (label: string, fn: () => Promise<unknown>, cls = 'btn small') =>
    h('button', {
      class: cls,
      onclick: async (e: Event) => {
        const b = e.currentTarget as HTMLButtonElement;
        b.disabled = true;
        const old = b.textContent;
        b.textContent = '⏳ Working…';
        try {
          await fn();
        } catch (err) {
          toast((err as Error).message, 'error', 5000);
        }
        b.textContent = old;
        b.disabled = false;
        armory();
      },
    }, label);

  const relicRow = (glyph: string, name: string, rarity: string, sub: (Node | string)[], actions: (Node | null)[]) =>
    h('div', { class: 'relic-row', style: `--rc:${rarityCss(rarity)}` },
      h('div', { class: 'glyph' }, glyph),
      h('div', { class: 'meta' }, h('div', { class: 'nm' }, name, ' ', h('span', { class: `small r-${rarity}` }, RARITY_INFO[rarity as keyof typeof RARITY_INFO].name)), h('div', { class: 'sub' }, ...sub)),
      ...actions);

  const inGame = inv.relics.filter((r) => r.state === 'in_game' || r.state === 'pending_mint');
  const minted = inv.relics.filter((r) => r.state === 'on_chain');
  const others = players.filter((p) => p.id !== me!.id);
  const xrplOk = cfg.flags.xrplConfigured;

  // Player switcher: the M4 demo needs a second player/wallet to trade with.
  const playerPanel = h('div', { class: 'panel' },
    h('h2', {}, '👤 Player'),
    h('div', { class: 'row' },
      h('select', { onchange: (e: Event) => { api.playerId = (e.target as HTMLSelectElement).value; boot(); } },
        ...players.map((p) => h('option', { value: p.id, selected: p.id === me!.id }, p.name))),
      h('button', { class: 'btn small secondary', onclick: async () => {
        const name = prompt('Name for the new player?') ?? undefined;
        const p = await api.createPlayer(name);
        api.playerId = p.id;
        await boot();
        armory();
      } }, '+ New player')),
    h('div', { class: 'muted small', style: 'margin-top:6px' }, 'Dev-only: switch players on this device to test trading between two wallets.'));

  let walletPanel: HTMLElement;
  if (!xrplOk) {
    walletPanel = h('div', { class: 'panel' }, h('h2', {}, '🔗 XRPL Testnet wallet'),
      h('p', { class: 'muted small' }, 'The server has no XRPL issuer configured. Run ', h('code', {}, 'npm run xrpl:setup'), ' and restart the server.'));
  } else if ('error' in wallet) {
    walletPanel = h('div', { class: 'panel' }, h('h2', {}, '🔗 XRPL Testnet wallet'), h('p', { class: 'muted small' }, `Could not reach XRPL: ${wallet.error}`));
  } else if (!wallet.address) {
    walletPanel = h('div', { class: 'panel' }, h('h2', {}, '🔗 XRPL Testnet wallet'),
      h('p', { class: 'muted small' }, 'No wallet yet. One is created and funded from the Testnet faucet the first time you mint, or now:'),
      busyBtn('Create Testnet wallet', () => api.createWallet(me!.id)));
  } else {
    const nfts = wallet.nfts ?? [];
    walletPanel = h('div', { class: 'panel' },
      h('h2', {}, '🔗 XRPL Testnet wallet'),
      h('div', { class: 'mono' }, h('a', { href: wallet.explorer!, target: '_blank', rel: 'noopener' }, wallet.address)),
      h('div', { class: 'muted small' }, `Balance: ${wallet.balance ?? '?'} XRP`,
        wallet.reserves ? ` · Reserve: ${wallet.reserves.baseXrp} XRP base + ${wallet.reserves.ownerXrp} XRP per owned object (NFT pages count)` : ''),
      h('h2', { style: 'margin-top:12px' }, 'On-chain relics in this wallet'),
      nfts.length
        ? h('div', { class: 'relic-list' }, ...nfts.map((n) => {
            const d = n.def;
            const transferSel = h('select', {}, h('option', { value: '' }, 'Send to…'), ...others.map((p) => h('option', { value: p.id }, p.name))) as HTMLSelectElement;
            return relicRow(d?.glyph ?? '❔', d?.name ?? `Taxon ${n.taxon}`, d?.rarity ?? 'common',
              [h('span', { class: 'badge chain' }, 'on-chain'), ' ', h('a', { href: n.explorer, target: '_blank', rel: 'noopener' }, 'explorer ↗')],
              [
                cfg!.flags.enableNftDeposit ? busyBtn('Deposit', async () => { await api.deposit(me!.id, n.nftokenId); toast(`${d?.name} is back in the game (NFT burned).`); }) : null,
                others.length ? h('div', { class: 'row' }, transferSel, busyBtn('Send', async () => {
                  if (!transferSel.value) throw new Error('Pick a player to send to');
                  await api.transfer(me!.id, n.nftokenId, { toPlayerId: transferSel.value });
                  toast('Sent!');
                }, 'btn small secondary')) : null,
              ]);
          }))
        : h('div', { class: 'muted small' }, 'No game relics in this wallet.'),
      !cfg.flags.enableNftDeposit ? h('div', { class: 'muted small' }, 'Deposits are disabled on this platform (ENABLE_NFT_DEPOSIT=false).') : null);
  }

  const inGamePanel = h('div', { class: 'panel' },
    h('h2', {}, '⚱️ In-game relics', h('span', { class: 'grow' }), h('span', { class: 'muted small' }, `${inGame.length}`)),
    inGame.length
      ? h('div', { class: 'relic-list' }, ...inGame.map((r: OwnedRelic) => relicRow(r.def.glyph, r.def.name, r.def.rarity,
          [r.def.effectText, r.foundInLevel ? ` · found in level ${r.foundInLevel}` : '', r.state === 'pending_mint' ? h('span', { class: 'badge pending' }, ' minting…') : ''],
          [xrplOk && r.state === 'in_game' ? busyBtn('Mint to wallet', async () => {
            const res = await api.mint(r.instanceId, me!.id);
            toast(`${r.def.name} minted on XRPL Testnet.`);
            console.info('Mint txs', res.txs);
          }) : null])))
      : h('div', { class: 'muted small' }, 'Nothing yet. Dig up relics in the campaign.'));

  const mintedPanel = minted.length
    ? h('div', { class: 'panel' },
        h('h2', {}, '📜 Minted by you'),
        h('p', { class: 'muted small' }, 'These left the game as NFTs. They can only be used again after being deposited (by whoever holds them).'),
        h('div', { class: 'relic-list' }, ...minted.map((r) => relicRow(r.def.glyph, r.def.name, r.def.rarity,
          [h('span', { class: 'badge chain' }, 'on-chain'), ' ', h('a', { href: `${explorer}/nft/${r.nftokenId}`, target: '_blank', rel: 'noopener' }, 'explorer ↗'), ` · ${r.txHashes.length} txs`],
          []))))
    : null;

  const relicPick = h('select', {}, ...cfg.relics.map((d) => h('option', { value: d.id }, `${d.glyph} ${d.name}`))) as HTMLSelectElement;
  const devPanel = cfg.flags.devGrant
    ? h('div', { class: 'panel' },
        h('h2', {}, '🧪 Dev: grant relic'),
        h('div', { class: 'row' }, relicPick, busyBtn('Grant', async () => {
          const res = await fetch('/api/dev/grant', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ playerId: me!.id, relicId: relicPick.value }) });
          if (!res.ok) throw new Error('Grant failed');
        }, 'btn small secondary')),
        h('div', { class: 'muted small', style: 'margin-top:6px' }, 'DEV_GRANT=true on the server. Bypasses drops; never enable on a shared server.'))
    : null;

  const supplyPanel = h('div', { class: 'panel' },
    h('h2', {}, '📊 Supply (all players)'),
    h('table', { class: 'rates' },
      h('tr', {}, h('th', {}, 'Relic'), h('th', {}, 'Found'), h('th', {}, 'Minted'), h('th', {}, 'Burned')),
      ...cfg.relics.map((d) => h('tr', {}, h('td', { class: `r-${d.rarity}` }, `${d.glyph} ${d.name}`), h('td', { class: 'n' }, stats.found[d.id] ?? 0), h('td', { class: 'n' }, stats.minted[d.id] ?? 0), h('td', { class: 'n' }, stats.burned[d.id] ?? 0)))));

  body.replaceChildren(
    h('div', { class: 'row' }, h('button', { class: 'btn small secondary', onclick: () => menu() }, '◀ Back'), h('h1', { class: 'title', style: 'font-size:2rem;flex:1;margin:0' }, 'Armory'), h('span', { style: 'width:70px' })),
    ...[playerPanel, inGamePanel, walletPanel, mintedPanel, devPanel, supplyPanel].filter((x): x is HTMLElement => !!x),
    h('div', { class: 'muted small', style: 'text-align:center' }, `XRPL Testnet only · issuer ${cfg.network.issuer ?? '—'}`));
}

boot();

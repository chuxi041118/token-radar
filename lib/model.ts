// The token radar's model (radar-2): one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and every
// rankable pre-token protocol below the watchlist floor, all scored by the same function. A protocol
// is pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol);
// the snapshot's live-token protocols are kept apart and shown as the market's own values, never
// mixed into the ranked board.
//
// Implied value is a valuation proxy, not a promise of an airdrop. It follows only from the
// snapshot's own figures, and no protocol name is ever special-cased: the same function scores
// every row.
//
//   tvlBase = ANCHOR_USD x (tvl_usd / ANCHOR_TVL_USD) ^ TVL_EXPONENT
//   G(g)    = 1 + GROWTH_SCALE x tanh(g / GROWTH_WIDTH) / (1 + (max(0, g - SPIKE_START) / 100) ^ 2)
//   A(d)    = AGE_FLOOR + AGE_RANGE x (1 - 2 ^ (-d / AGE_HALF_LIFE_DAYS))
//   implied = max(1, round(tvlBase x G(g) x A(d)))
//
// Why this shape:
// - TVL enters sublinearly (exponent 0.85): a protocol ten times larger is not worth ten times
//   more; fully-diluted value compresses against TVL as protocols grow. The $25M anchor keeps
//   the starter's 0.25x reference at $100M of TVL, before the adjustments.
// - Growth saturates: tanh flattens ordinary moves, and the spike term tapers the bonus above
//   +100% a week, so a +4,448% print counts for less than a +40% one. A one-week jump that
//   large is usually a listing artifact or a one-off inflow, not durable growth; the model
//   says so in the open instead of rewarding it.
// - Age is a soft plateau, not a line: most of the token overhang accrues in the first year
//   (0.65 at listing, ~0.88 at one year, ~0.96 at two years) and extra years add little.
// - Chain count and category stay out of the formula: the snapshot gives no benchmark for
//   what a chain or a sector is worth, so the model does not invent one. Category decides
//   the farm plan, where it is verifiable, not the value, where it would be a guess.
// - Missing growth scores neutral (1.00x) and is flagged; missing age scores at the neutral
//   one-year value (365 days) and is flagged. Nothing is silently imputed.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  anchor_usd: number;
  anchor_tvl_usd: number;
  tvl_exponent: number;
  growth_scale: number;
  growth_width: number;
  spike_start: number;
  age_floor: number;
  age_range: number;
  age_half_life_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  anchor_usd: 25_000_000,
  anchor_tvl_usd: 100_000_000,
  tvl_exponent: 0.85,
  growth_scale: 0.2,
  growth_width: 30,
  spike_start: 100,
  age_floor: 0.65,
  age_range: 0.35,
  age_half_life_days: 240,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  on_watchlist: boolean;
  model: {
    tvl_base_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  tvl_base_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  on_watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The growth multiplier: saturating in ordinary moves, tapering past a one-week spike. */
export function growthMultiplier(growthPct: number, model: ModelConstants): number {
  const spike = Math.max(0, growthPct - model.spike_start) / 100;
  return 1 + model.growth_scale * (Math.tanh(growthPct / model.growth_width) / (1 + spike * spike));
}

/** The maturity multiplier: a soft plateau over the token overhang's half-life. */
export function maturityMultiplier(ageDaysValue: number, model: ModelConstants): number {
  return model.age_floor + model.age_range * (1 - Math.pow(2, -ageDaysValue / model.age_half_life_days));
}

/** The three factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; tvlBase: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = finite(protocol.change_7d, 0);
  const growthMult = growthMultiplier(growthPct, model);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = maturityMultiplier(ageForModel, model);
  const tvlBase = model.anchor_usd * Math.pow(protocol.tvl_usd / model.anchor_tvl_usd, model.tvl_exponent);
  const implied = Math.max(1, Math.round(tvlBase * growthMult * maturityMult));
  return { implied, tvlBase: Math.round(tvlBase), growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the watchlist floor, scored by the same
  // model as the watchlist — picked by implied value, never by TVL alone. Never a replacement for a
  // watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols.filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, tvlBase, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, model);
    return { p, implied, tvlBase, growthPct, growthMult, maturityMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    on_watchlist: snapshot.watchlist.includes(s.p.slug),
    model: {
      tvl_base_usd: s.tvlBase,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The category family a protocol's farm plan follows, from its own category string. */
function familyOf(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('curator') || c.includes('allocator')) return 'curator';
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lending';
  if (c.includes('dex') || c.includes('liquidity manager')) return 'dex';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('basis')) return 'basis';
  if (c.includes('yield')) return 'yield';
  if (c.includes('restak')) return 'restaking';
  if (c.includes('liquid staking')) return 'liquid-staking';
  if (c.includes('staking')) return 'staking';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('perpetual') || c.includes('derivative')) return 'derivatives';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('stable')) return 'stable';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('payment')) return 'payments';
  if (c.includes('governance')) return 'governance';
  if (c.includes('chain') && !c.includes('blockchain')) return 'chain';
  if (c.includes('cedefi')) return 'cedefi';
  return 'other';
}

/** What the plan farms: the vault, pool or market, in the words of the protocol's own kind. */
function subjectOf(family: string): string {
  if (family === 'curator') return 'vault';
  if (family === 'dex') return 'pool';
  if (family === 'lending') return 'market';
  if (family === 'bridge') return 'route';
  if (family === 'staking') return 'stake';
  if (family === 'liquid-staking') return 'receipt';
  if (family === 'restaking') return 'vault';
  if (family === 'insurance') return 'policy';
  if (family === 'governance') return 'program';
  return 'position';
}

/** The plan's first step: verify the exact thing you would farm, or stop. */
function verifyStep(p: SnapshotProtocol, family: string, chain: string): FarmStep {
  const subject = subjectOf(family);
  if (family === 'governance') {
    return {
      text: `Check whether ${p.name} runs a governance program you can join without a token, on its own forum or docs. If it needs a token that does not exist yet, there is nothing to farm — watch the announcements step instead.`,
      cost: 'no fee to check',
      time: '15 minutes',
    };
  }
  if (family === 'rwa') {
    return {
      text: `Read ${p.name}'s own eligibility, minimum subscription and redemption terms for its ${subject} on ${chain}. If you are not eligible, stop here — do not farm a gated product through a third party.`,
      cost: 'no fee to check',
      time: '15 minutes',
    };
  }
  if (family === 'liquid-staking') {
    return {
      text: `Read ${p.name}'s own docs for which asset it takes and what receipt token it issues, and confirm the receipt still trades near its redemption value. If the receipt trades at a deep discount, the exit is broken — stop here.`,
      cost: 'no fee to check',
      time: '15 minutes',
    };
  }
  if (family === 'restaking') {
    return {
      text: `Read ${p.name}'s own slashing conditions and withdrawal queue before you deposit anything. If the slashing terms or the unbonding wait are not published, stop here — restaking without published terms is an unpriced risk.`,
      cost: 'no fee to check',
      time: '15 minutes',
    };
  }
  return {
    text: `Find the exact ${subject} on ${p.name}'s own site and read its rules — minimum deposit, lock or withdrawal queue, and which asset it takes. If you cannot verify the ${subject} from the protocol's own pages, stop here.`,
    cost: 'no fee to check',
    time: '15 minutes',
  };
}

/** The plan's second step: the deposit itself, with an illustrative budget and a stop rule. */
function actionStep(p: SnapshotProtocol, family: string, chain: string): FarmStep {
  const name = p.name;
  const budget = '$50 (illustrative)';
  if (family === 'curator') {
    return {
      text: `Deposit ${budget} of USDC into a vault ${name} manages on ${chain} and keep the shares. If the vault's minimum is above $50, size up only to an amount you can leave untouched, or skip this protocol.`,
      cost: '$50 of capital and about $4 of gas',
      time: '15 minutes to set up',
    };
  }
  if (family === 'lending') {
    return {
      text: `Supply ${budget} of USDC to ${name}'s market on ${chain} and keep the position open. If the market's minimum is above $50, size up only to an amount you can leave untouched, or skip it.`,
      cost: '$50 of capital and about $4 of gas',
      time: '15 minutes to set up',
    };
  }
  if (family === 'dex') {
    return {
      text: `Provide ${budget} of liquidity to ${name}'s main pool on ${chain} and keep the position open. Skip the pool if you cannot read its fee tier and range from the protocol's own page.`,
      cost: '$50 of capital and about $4 of gas',
      time: '15 minutes to set up',
    };
  }
  if (family === 'rwa') {
    return {
      text: `Subscribe ${budget} to ${name}'s offering on ${chain} once eligibility is confirmed, and hold the asset. If redemptions are locked for longer than you can wait, skip it.`,
      cost: '$50 of capital and about $4 of gas',
      time: '15 minutes to set up',
    };
  }
  if (family === 'basis') {
    return {
      text: `Deposit ${budget} of USDC into ${name}'s basis vault on ${chain} and keep the shares. If the vault is closed to new deposits, stop — do not buy a share second-hand.`,
      cost: '$50 of capital and about $4 of gas',
      time: '15 minutes to set up',
    };
  }
  if (family === 'yield') {
    return {
      text: `Deposit ${budget} of USDC into ${name}'s main vault on ${chain} and keep the shares. If the vault's strategy or fees are not published, skip it.`,
      cost: '$50 of capital and about $4 of gas',
      time: '15 minutes to set up',
    };
  }
  if (family === 'staking') {
    return {
      text: `Stake ${budget} of the chain's staking asset through ${name} and keep the receipt. If ${name} issues a receipt token, hold it — do not sell it.`,
      cost: '$50 of capital and about $4 of gas',
      time: '15 minutes to set up',
    };
  }
  if (family === 'liquid-staking') {
    return {
      text: `Deposit ${budget} of the underlying asset into ${name} on ${chain} and hold the receipt token it issues. The receipt itself accrues the yield — do not sell it. If the receipt trades below its redemption value, hold it instead of paying to exit.`,
      cost: '$50 of capital and about $4 of gas',
      time: '15 minutes to set up',
    };
  }
  if (family === 'restaking') {
    return {
      text: `Deposit ${budget} of the receipt token into ${name}'s restaking vault on ${chain} and keep the position. If the vault is closed to new deposits or the unbonding wait is longer than you can wait, skip it.`,
      cost: '$50 of capital and about $4 of gas',
      time: '15 minutes to set up',
    };
  }
  if (family === 'bridge') {
    return {
      text: `Bridge ${budget} of USDC to ${chain} through ${name} and use the bridged funds in one of that chain's apps, instead of bridging straight back.`,
      cost: '$50 of capital and about $4 of gas',
      time: '15 minutes to set up',
    };
  }
  if (family === 'derivatives') {
    return {
      text: `Deposit ${budget} of USDC as margin on ${name} and open one small hedged position. Close it within the week unless the protocol's own rules reward holding it.`,
      cost: '$50 of capital and about $4 of gas',
      time: '15 minutes to set up',
    };
  }
  if (family === 'insurance') {
    return {
      text: `Buy ${budget} of cover from ${name} on ${chain} and keep the policy until it expires. Read what the cover excludes before you pay.`,
      cost: '$50 of capital and about $4 of gas',
      time: '15 minutes to set up',
    };
  }
  if (family === 'stable') {
    return {
      text: `Mint or deposit ${budget} of the stable asset through ${name} on ${chain}. If the peg mechanism is not documented, skip it.`,
      cost: '$50 of capital and about $4 of gas',
      time: '15 minutes to set up',
    };
  }
  if (family === 'prediction') {
    return {
      text: `Fund ${budget} and place one market position on ${name}. A prediction market pays for being right, not for activity — one position is the plan.`,
      cost: '$50 of capital and about $4 of gas',
      time: '15 minutes to set up',
    };
  }
  if (family === 'payments') {
    return {
      text: `Move ${budget} through ${name} on ${chain} and keep the receipt. A payment rail with no points program is a weak farm — check the rewards step before you spend more.`,
      cost: '$50 of capital and about $4 of gas',
      time: '15 minutes to set up',
    };
  }
  if (family === 'governance') {
    return {
      text: `Join the governance program ${name} documents — forum, delegation or testnet — and take part once. If it needs a token that does not exist yet, there is nothing to do here.`,
      cost: 'no fee to join',
      time: '15 minutes to set up',
    };
  }
  if (family === 'chain') {
    return {
      text: `Bridge ${budget} to ${chain} through its official bridge, use one of its native apps, and keep the position. A chain's token, if it comes, usually rewards early users of the chain itself.`,
      cost: '$50 of capital and about $4 of gas',
      time: '15 minutes to set up',
    };
  }
  if (family === 'cedefi') {
    return {
      text: `Deposit ${budget} into ${name}'s product on ${chain} and keep the position. CeDeFi products are custodial — confirm who holds the funds before you deposit.`,
      cost: '$50 of capital and about $4 of gas',
      time: '15 minutes to set up',
    };
  }
  return {
    text: `Deposit ${budget} of USDC into ${name} on ${chain} and keep the position open. If the minimum is above $50, size up only to an amount you can leave untouched, or skip it.`,
    cost: '$50 of capital and about $4 of gas',
    time: '15 minutes to set up',
  };
}

/** The plan's third step: the weekly review, a check of the position, not activity for its own sake. */
function reviewStep(p: SnapshotProtocol, family: string): FarmStep {
  const name = p.name;
  if (family === 'curator') {
    return {
      text: `Once a week, read the curator's rebalance or allocation notes for your vault and confirm your shares are still in it. Do not move funds just to generate activity.`,
      cost: 'about $2 of gas a week, only when you act',
      time: '10 minutes a week',
    };
  }
  if (family === 'lending') {
    return {
      text: `Once a week, check the borrow rate and your position's health on ${name}, and top up collateral only if it is close to liquidation.`,
      cost: 'about $2 of gas a week, only when you act',
      time: '10 minutes a week',
    };
  }
  if (family === 'dex') {
    return {
      text: `Once a week, check the pool's fees and your share on ${name}. If the price moved out of your range, decide once whether to re-range — do not churn it.`,
      cost: 'about $2 of gas a week, only when you act',
      time: '10 minutes a week',
    };
  }
  if (family === 'rwa') {
    return {
      text: `Once a week, check the redemption window and the asset's backing report for ${name}. If redemptions are paused, wait — do not exit through a third party.`,
      cost: 'about $2 of gas a week, only when you act',
      time: '10 minutes a week',
    };
  }
  if (family === 'staking') {
    return {
      text: `Once a week, confirm your stake and its receipt are still in place on ${name}. Restaking rewards accrue to the position, not to transactions.`,
      cost: 'about $2 of gas a week, only when you act',
      time: '10 minutes a week',
    };
  }
  if (family === 'derivatives') {
    return {
      text: `Once a week, check the margin on ${name} and close or roll the position. Do not hold a leveraged position you are not watching.`,
      cost: 'about $2 of gas a week, only when you act',
      time: '10 minutes a week',
    };
  }
  if (family === 'liquid-staking') {
    return {
      text: `Once a week, check the receipt token's price against its redemption value and confirm your balance is still in place on ${name}. A receipt that drifts from redemption value is the position telling you something — do not ignore it.`,
      cost: 'about $2 of gas a week, only when you act',
      time: '10 minutes a week',
    };
  }
  if (family === 'restaking') {
    return {
      text: `Once a week, check the slashing status and the withdrawal queue on ${name}. Restaked positions are the ones that get cut when something breaks — a weekly check is the whole job.`,
      cost: 'about $2 of gas a week, only when you act',
      time: '10 minutes a week',
    };
  }
  return {
    text: `Once a week, open the position on ${name} and confirm it is still active. A review is activity enough — do not transact just to make noise.`,
    cost: 'about $2 of gas a week, only when you act',
    time: '10 minutes a week',
  };
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names — and every step carries its stop rule, so a plan that cannot be farmed says so instead of
 * inventing a route.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const family = familyOf(p);
  return [
    verifyStep(p, family, chain),
    actionStep(p, family, chain),
    reviewStep(p, family),
    {
      text: `Open ${p.name}'s own points or rewards page. If it documents a points program, confirm your position counts toward it; if it documents none, treat any future reward as unconfirmed and do not farm on a promise the protocol never made.`,
      cost: 'no fee to check',
      time: '10 minutes',
    },
    {
      text: `Watch ${p.name}'s own announcements for snapshot dates and eligibility rules. Airdrops are announced by the protocol itself, never by a reply, a DM or a lookalike account.`,
      cost: 'nothing',
      time: '5 minutes a week',
    },
    {
      text: `Verify every contract address from ${p.name}'s own docs before you sign. Never pay anyone to claim, never connect a wallet from a link someone sent you, and revoke the approval when you exit.`,
      cost: 'nothing',
      time: '5 minutes',
    },
    {
      text: `Write the wallet, the dates, the amounts and every transaction hash in a farm log, so you can prove the position later or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    tvl_base_usd: row.model.tvl_base_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    on_watchlist: row.on_watchlist,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.on_watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

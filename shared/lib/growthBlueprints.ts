// BouldHQ — Growth Engine blueprints.
//
// The accountability tracker behind /growth. Two halves:
//
//   AGENCY     — Bould's own marketing build-out. One-time tracks (site, ads,
//                content/outbound) plus a weekly operating rhythm that resets.
//   BLUEPRINTS — the phase-gated playbook we run on a client store, keyed by
//                store archetype. Every store also gets the MONTHLY operating
//                cycle, which resets on the first business day of the month.
//
// Task ids are globally unique (each list uses its own prefix) and are the
// primary key of a check in the DB — never renumber or reuse one, or historical
// progress silently reattaches to the wrong task. Adding tasks is safe;
// removing one orphans its check rows, which `growth.state` ignores.

export type GrowthTask = {
  /** Stable id. Prefix identifies the list — see PREFIX notes on each block. */
  id: string;
  title: string;
  /** The "why" line. Empty string means the task speaks for itself. */
  why: string;
};

export type GrowthBlock = {
  id: string;
  /** Short mono label rendered above the title, e.g. "Phase 0". */
  tag: string;
  title: string;
  /** Stage gate copy shown under the task list. Blocks progress by convention. */
  gate?: string;
  /** Agency only: this block resets every week instead of accumulating. */
  weekly?: boolean;
  tasks: GrowthTask[];
};

export type BlueprintType = 'dtc' | 'local' | 'b2b' | 'resale';

const t = (id: string, title: string, why = ''): GrowthTask => ({ id, title, why });

/* ============================ AGENCY ============================ */
/* prefixes: w0- a- b- c- r-  (r- is the weekly rhythm) */

export const AGENCY: GrowthBlock[] = [
  {
    id: 'w0',
    tag: 'Week 0',
    title: 'Partner leverage',
    tasks: [
      t('w0-1', 'Pull pre/post metrics from client stores (CVR, AOV, returns)', 'Ask permission first. Real numbers from 9 stores is proof every competitor has to fake.'),
      t('w0-2', 'Add “Built by Bould” footer link on every client site', 'Nine referring domains from live commerce sites — SEO plus referral traffic.'),
      t('w0-3', 'Optimize Shopify Partner Directory profile for 3D / AR / try-on', 'Merchants searching inside Shopify have the highest intent of any channel.'),
      t('w0-4', 'Request Partner Directory reviews from 3–4 clients', 'Social proof where buyers actually look.'),
      t('w0-5', 'Verify each client owns their store billing (collaborator, not owner)', 'Agency-owned stores create liability and churn leverage against you.'),
      t('w0-6', 'Unpublish or redirect the discontinued app listing', 'A dead app with 0 reviews under your name hurts credibility with merchants.'),
    ],
  },
  {
    id: 'a',
    tag: 'Track A',
    title: 'Site build & optimization',
    tasks: [
      t('a-1', 'Unify stats site-wide (one defensible set)', '7+ vs 5+ brands and 300% vs 40% kills trust with sophisticated buyers.'),
      t('a-2', 'Move $0.00 demo products + cart off homepage to /pages/demo', 'Homepage must read agency, not store, in 5 seconds.'),
      t('a-3', 'Case study #1 live (problem → build → metric → quote)', 'Highest-converting agency asset. Ads and outbound both depend on it.'),
      t('a-4', 'Case study #2 live'),
      t('a-5', 'Case study #3 live'),
      t('a-6', 'Title-first load choreography: static H1 as LCP → FLIP-move to position → Three.js cross-fades in behind', 'Text paints instantly, 3D becomes a designed moment instead of a delay. Honor prefers-reduced-motion.'),
      t('a-7', 'Landing page /3d-shopify-store for the 3D ad group', 'widget.bouldhq.com covers try-on; 3D commerce still needs its own page.'),
      t('a-8', 'Embed scheduler; booked call = primary conversion', 'Booked call beats form fill as the event you optimize toward.'),
      t('a-9', 'Title tags + meta descriptions on every page', 'Homepage is currently just “Bould” — free ranking signal.'),
      t('a-10', 'GA4 + Google Ads tag + Search Console + Meta Pixel installed and test-fired', 'Nothing after this point is measurable without it.'),
    ],
  },
  {
    id: 'b',
    tag: 'Track B',
    title: 'Google Ads',
    tasks: [
      t('b-1', 'Build 1 Search campaign, 4 ad groups: 3D commerce / Try-on / Plus dev / Local', 'Phrase + exact match only. No PMax, no Display for lead-gen at this size.'),
      t('b-2', 'Load day-one negatives: jobs, salary, free, cheap, tutorial, course, template, theme, how to, wordpress, wix, login, plugin'),
      t('b-3', 'Write 3 RSA variants per ad group, outcome-first copy', '“Your product, in 3D. 40% conversion lift” — not “full-service agency.”'),
      t('b-4', 'Add sitelinks (case studies), image extensions (3D screenshots), call extension'),
      t('b-5', 'Launch at $50–80/day on Maximize Clicks', 'Below ~$1,500/mo you can’t collect enough data to learn.'),
      t('b-6', 'Calendar block: weekly search-terms review every Wednesday', 'Negatives discipline is where small accounts win or die.'),
      t('b-7', 'Switch to Target CPA after 15–30 conversions'),
      t('b-8', 'IG retargeting at $10/day once pixel ≥ 500 visitors', 'The only paid social that makes sense: warm traffic only.'),
    ],
  },
  {
    id: 'c',
    tag: 'Track C',
    title: 'Content & outbound',
    tasks: [
      t('c-1', 'Define the 4 formats + hook list (walkthroughs 40% / teardowns 30% / before-after 15% / founder 15%)', 'Screen-recorded product, not talking-head marketing tips.'),
      t('c-2', 'Batch-record session #1: 4–5 videos in one block', '9:16, under 30s, captions burned in, product in frame 1, no logo intro.'),
      t('c-3', 'Publish week 1 across Reels + TikTok + Shorts + LinkedIn'),
      t('c-4', 'Set up comment-trigger → DM → free 3D mockup → call pipeline', 'The personalized mockup is the close. Almost nobody else can produce one in an hour.'),
      t('c-5', 'Build outbound list: 200 apparel/accessory brands, $1–20M', 'Founder sends, not a BDR. Agencies are bought from people.'),
      t('c-6', 'Send first 20 personalized outreach (Loom or 3D mockup attached)', 'Expect 10–20% replies with this level of personalization vs 1–2% for generic.'),
    ],
  },
  {
    id: 'r',
    tag: 'Weekly',
    title: 'Operating rhythm',
    weekly: true,
    tasks: [
      t('r-1', 'Mon — batch-record 4–5 videos'),
      t('r-2', 'Mon — send 15–20 personalized outbound'),
      t('r-3', 'Wed — Google Ads search-terms report + add negatives'),
      t('r-4', 'Fri — log qualified calls by source in the sheet', 'The only metric that matters: qualified sales calls per month, by source.'),
      t('r-5', 'Ship 4–5 posts this week'),
    ],
  },
];

/* ============================ DTC ============================ */
/* prefix: d0- d1- d2- d3- d4- */

const DTC: GrowthBlock[] = [
  {
    id: 'd0',
    tag: 'Phase 0',
    title: 'Economics & tracking gate',
    gate: 'Hard gate — zero ad spend until every box above is checked. Paying for traffic you can’t measure into economics you don’t know is burning the client’s money.',
    tasks: [
      t('d0-1', 'Unit economics sheet: gross margin, AOV, 90-day LTV, breakeven MER', 'This number decides every budget call later.'),
      t('d0-2', 'GA4 + Meta Pixel/CAPI + Google Ads tag + consent mode, verified with test orders'),
      t('d0-3', 'Google Merchant Center feed clean: titles, GTINs, images, zero disapprovals', 'Feed quality is 50% of Shopping/PMax performance.'),
      t('d0-4', 'Klaviyo connected; core segments built (engaged, buyers, VIP)'),
      t('d0-5', 'Baseline dashboard live: sessions, CVR, AOV, MER'),
    ],
  },
  {
    id: 'd1',
    tag: 'Phase 1',
    title: 'Convert & retain first',
    gate: 'Gate — CVR baseline documented and flows sending before traffic. Costs 2–3 weeks of ad revenue; buys not wasting the budget on a leaky store.',
    tasks: [
      t('d1-1', 'PDP pass: photos, size guidance, reviews visible, shipping & returns clarity'),
      t('d1-2', 'Mobile speed pass: LCP under 2.5s'),
      t('d1-3', 'Email flows live: welcome, abandoned checkout, browse abandon, post-purchase', 'Flows convert 3–5x campaigns and work while ads sleep.'),
      t('d1-4', 'Reviews app collecting; UGC rights workflow in place'),
      t('d1-5', 'First-purchase offer defined and tested'),
    ],
  },
  {
    id: 'd2',
    tag: 'Phase 2',
    title: 'Traffic ignition',
    gate: 'Gate — hold floor budget until MER ≥ breakeven for 2 consecutive weeks. Scaling a losing account just loses faster.',
    tasks: [
      t('d2-1', 'Google: branded Search + standard Shopping live', 'Standard Shopping first — builds conversion data with full visibility.'),
      t('d2-2', 'Meta: one broad prospecting CBO, 3–5 distinct creative concepts', 'For impulse-priced visual products Meta is the core engine — the reverse of the agency’s own playbook.'),
      t('d2-3', 'Creative pipeline running: 5–10 new ads/month (UGC, founder, product demo)', 'On Meta, creative is the targeting.'),
      t('d2-4', 'Organic short-form 3–4x/week; winners recycled into paid'),
      t('d2-5', 'Migrate Shopping → Performance Max after ~30 conversions, brand terms excluded', 'PMax is opaque but beats manual Shopping at this team size — exclusions keep it honest.'),
    ],
  },
  {
    id: 'd3',
    tag: 'Phase 3',
    title: 'Scale & measure',
    tasks: [
      t('d3-1', 'Weekly: negatives + creative winner/loser calls'),
      t('d3-2', 'Report MER + contribution margin, never platform ROAS', 'Platforms grade their own homework; blended numbers don’t lie.'),
      t('d3-3', 'Scale winners max 20% per week', 'Bigger jumps reset learning and spike CPAs.'),
      t('d3-4', 'Monthly incrementality sanity check (brand-search holdout or lite geo test)'),
      t('d3-5', 'Quarterly LTV cohort review → adjust breakeven MER'),
    ],
  },
  {
    id: 'd4',
    tag: 'Phase 4',
    title: 'Compound',
    tasks: [
      t('d4-1', 'SMS + loyalty program (only if margin supports it)'),
      t('d4-2', 'Dedicated landing page per winning ad concept'),
      t('d4-3', 'Affiliate / influencer seeding program'),
    ],
  },
];

/* ============================ LOCAL ============================ */
/* prefix: l0- l1- l2- l3- */

const LOCAL: GrowthBlock[] = [
  {
    id: 'l0',
    tag: 'Phase 0',
    title: 'Foundation',
    gate: 'Gate — no ad spend until calls and forms are tracked. Local budgets are small; untracked spend is invisible spend.',
    tasks: [
      t('l0-1', 'Google Business Profile claimed: categories, services, service area, photos', 'GBP is the homepage for local intent.'),
      t('l0-2', 'Call tracking + form tracking live'),
      t('l0-3', 'NAP (name, address, phone) consistent across citations'),
    ],
  },
  {
    id: 'l1',
    tag: 'Phase 1',
    title: 'Reputation engine',
    tasks: [
      t('l1-1', 'Automated post-job review ask via SMS/email', 'Reviews are the #1 local ranking and conversion factor.'),
      t('l1-2', 'Hit +10 new Google reviews'),
      t('l1-3', 'Service + city landing pages live (one per core service)'),
    ],
  },
  {
    id: 'l2',
    tag: 'Phase 2',
    title: 'Demand capture',
    tasks: [
      t('l2-1', 'Google Local Services Ads live (if category is eligible)', 'Pay-per-lead with the Google Guaranteed badge — best local ROI, so it goes first.'),
      t('l2-2', 'Local Search campaign + call extensions, tight geo'),
      t('l2-3', 'Weekly job photos posted to GBP'),
    ],
  },
  {
    id: 'l3',
    tag: 'Phase 3',
    title: 'Compound',
    tasks: [
      t('l3-1', 'Referral offer sent to past customer list'),
      t('l3-2', 'Monthly before/after short-form content'),
      t('l3-3', 'Track cost per booked job by source', 'Not cost per click, not cost per lead — booked jobs.'),
    ],
  },
];

/* ============================ B2B ============================ */
/* prefix: b0- b1- b2- b3- */

const B2B: GrowthBlock[] = [
  {
    id: 'b0',
    tag: 'Phase 0',
    title: 'Economics & pipeline tracking',
    gate: 'Hard gate — no spend and no outbound until quote requests and calls are tracked and average account value is known. B2B deals are few and large; losing attribution on even one is expensive.',
    tasks: [
      t('b0-1', 'Account economics: average order value, reorder rate, 12-month account value', 'One account here is worth hundreds of DTC orders — budget math is completely different.'),
      t('b0-2', 'Quote-request + call tracking live; CRM or Shopify B2B capturing every inquiry'),
      t('b0-3', 'Line sheets / catalog ready to send within minutes of an inquiry', 'Speed-to-quote is the #1 conversion lever in wholesale.'),
      t('b0-4', 'Pricing tiers + minimum order quantities defined and published'),
    ],
  },
  {
    id: 'b1',
    tag: 'Phase 1',
    title: 'Convert the inquiry',
    tasks: [
      t('b1-1', 'Wholesale portal or B2B storefront live (Shopify B2B / password catalog)'),
      t('b1-2', 'Frictionless quote flow: no account walls before the ask'),
      t('b1-3', 'Email nurture for accounts: welcome, sample follow-up, reorder reminders', 'Reorders are the profit engine — automate them before chasing new accounts.'),
      t('b1-4', '2–3 account case studies or stockist logos on site'),
    ],
  },
  {
    id: 'b2',
    tag: 'Phase 2',
    title: 'Demand — lead-gen, not ecommerce',
    gate: 'Meta prospecting is rejected here for the same reason it was rejected for Bould itself: few high-value buyers, long cycles — paying for mass reach is waste. Search intent + direct outreach win.',
    tasks: [
      t('b2-1', 'Google Search on category + wholesale / distributor / bulk / supplier keywords'),
      t('b2-2', 'Founder/rep outbound to retail buyers (15–20/week, personalized)'),
      t('b2-3', 'List on trade marketplaces where the category fits (Faire, RangeMe, industry directories)'),
      t('b2-4', 'Referral ask built into every fulfilled account'),
    ],
  },
  {
    id: 'b3',
    tag: 'Phase 3',
    title: 'Scale accounts',
    tasks: [
      t('b3-1', 'Track reorder rate + account LTV monthly, not just new inquiries'),
      t('b3-2', 'Win-back sequence for accounts silent 60+ days'),
      t('b3-3', 'Expand SKU penetration per account (cross-sell the catalog)'),
    ],
  },
];

/* ============================ RESALE ============================ */
/* prefix: t0- t1- t2- t3- */

const RESALE: GrowthBlock[] = [
  {
    id: 't0',
    tag: 'Phase 0',
    title: 'Inventory-proof foundation',
    gate: 'Gate — the feed must auto-remove sold items before any catalog ads run. Ads pointing at sold-out one-of-ones burn money and trust simultaneously.',
    tasks: [
      t('t0-1', 'Tracking installed; product feed auto-syncs sold-out items off channels'),
      t('t0-2', 'Per-item margin math: sourcing cost, fees, target days-to-sell'),
      t('t0-3', 'Fast listing workflow: photo → live product in minutes, consistent template', 'Listing speed is inventory velocity — the core operational advantage in resale.'),
      t('t0-4', 'Drop calendar defined (weekly or biweekly, fixed day + time)'),
    ],
  },
  {
    id: 't1',
    tag: 'Phase 1',
    title: 'Own the audience first',
    gate: 'Gate — list capture before paid. In resale the product is gone tomorrow; the audience is the only durable asset you’re building.',
    tasks: [
      t('t1-1', 'Email + SMS capture with drop notifications as the hook'),
      t('t1-2', 'Notify-me / back-in-brand alerts (by size, brand, category)'),
      t('t1-3', 'Drop-announcement flow: teaser → live → last-call'),
    ],
  },
  {
    id: 't2',
    tag: 'Phase 2',
    title: 'Demand — drops as events',
    gate: 'Single-product ads are rejected: they die when the item sells. Only live-feed catalog ads and audience-building content survive one-of-one inventory.',
    tasks: [
      t('t2-1', 'Organic engine: sourcing hauls, pickup videos, styling, drop teasers 4–5x/week', 'Content IS the acquisition channel here — paid only amplifies it.'),
      t('t2-2', 'Meta catalog ads (DPA) on the live feed, broad audience — never single-item ads'),
      t('t2-3', 'Cross-list to marketplaces (eBay, Depop, Grailed, Poshmark) as distribution'),
      t('t2-4', 'VIP early access for SMS list (15–30 min head start)', 'Scarcity + access is the whole retention model.'),
    ],
  },
  {
    id: 't3',
    tag: 'Phase 3',
    title: 'Velocity & scale',
    tasks: [
      t('t3-1', 'KPIs: sell-through rate + median days-to-sell, reviewed weekly', 'Not ROAS — inventory velocity is the business.'),
      t('t3-2', 'Never miss a drop date two months straight — consistency compounds'),
      t('t3-3', 'Reinvest margin into sourcing volume; track $ listed per week'),
    ],
  },
];

export const BLUEPRINTS: Record<BlueprintType, GrowthBlock[]> = {
  dtc: DTC,
  local: LOCAL,
  b2b: B2B,
  resale: RESALE,
};

export const BLUEPRINT_TYPES = Object.keys(BLUEPRINTS) as BlueprintType[];

export const TYPE_LABEL: Record<BlueprintType, string> = {
  dtc: 'DTC / personal',
  local: 'Local service',
  b2b: 'B2B / distributor',
  resale: 'Resale / drops',
};

/** Long-form labels for the blueprint picker. */
export const TYPE_DESCRIPTION: Record<BlueprintType, string> = {
  dtc: 'DTC / personal brand / single product',
  local: 'Local service business',
  b2b: 'Distributor / B2B wholesale',
  resale: 'Resale / thrift / drops',
};

/* ============================ MONTHLY ============================ */
/* prefix: m- — resettable, and excluded from a store's progress % */

export const MONTHLY: GrowthTask[] = [
  t('m-1', 'Pull the numbers: revenue, blended MER/CAC, CVR, AOV, email+SMS share of revenue'),
  t('m-2', 'Compare vs breakeven target and the 3-month trend — write one sentence of “why”', 'A number without a why is reporting, not operating.'),
  t('m-3', 'Kill the worst performer (one ad set, creative, or keyword group)'),
  t('m-4', 'Ship ONE test from the backlog — single variable, defined success metric', 'One clean test/month beats five muddy ones: at this spend you can’t attribute five.'),
  t('m-5', 'Send client report: what happened → why → the one move next month', 'Three sections, one page. Clients renew on clarity, not dashboards.'),
  t('m-6', 'Refresh creative: 5–10 new ads or 4 organic winners recycled into paid'),
  t('m-7', 'Add 2 new hypotheses to the test backlog'),
  t('m-8', 'Quarterly only: LTV cohort review, channel-mix reset, pricing/offer check'),
];

/* ============================ NOTES ============================ */

export const BUDGET_GATE_NOTE =
  'DTC needs ≈ $3k/mo in ad budget to get signal — below that, run Phases 0–1 + organic and email only. ' +
  'Local ≈ $1–1.5k/mo. B2B ≈ $1–2k/mo search + founder outbound time. Resale runs organic-first; paid only ' +
  'after the list engine is live. Taking ad money below the floor produces noise, not learning.';

export const DTC_MODIFIER_NOTE =
  'Single-product landing page — skip catalog breadth, double down on LP creative testing, fix AOV with ' +
  'bundles/upsells. Personal brand — the founder’s face IS the channel: organic weight up, paid only ' +
  'amplifies proven organic winners.';

/* ============================ HELPERS ============================ */

/** Scope of a check row. Determines which reset button clears it. */
export type GrowthScope = 'agency' | 'weekly' | 'store' | 'monthly';

const AGENCY_TASK_IDS = new Set(
  AGENCY.filter((b) => !b.weekly).flatMap((b) => b.tasks.map((x) => x.id)),
);
const WEEKLY_TASK_IDS = new Set(
  AGENCY.filter((b) => b.weekly).flatMap((b) => b.tasks.map((x) => x.id)),
);
const STORE_TASK_IDS = new Set(
  BLUEPRINT_TYPES.flatMap((k) => BLUEPRINTS[k].flatMap((b) => b.tasks.map((x) => x.id))),
);
const MONTHLY_TASK_IDS = new Set(MONTHLY.map((x) => x.id));

const IDS_BY_SCOPE: Record<GrowthScope, Set<string>> = {
  agency: AGENCY_TASK_IDS,
  weekly: WEEKLY_TASK_IDS,
  store: STORE_TASK_IDS,
  monthly: MONTHLY_TASK_IDS,
};

/**
 * True when `taskId` is a real task in `scope`. The server rejects anything
 * else so a stale client can't write junk rows that never get cleaned up.
 */
export function isKnownTask(scope: GrowthScope, taskId: string): boolean {
  return IDS_BY_SCOPE[scope]?.has(taskId) ?? false;
}

export function isBlueprintType(value: string): value is BlueprintType {
  return value in BLUEPRINTS;
}

/** Total one-time tasks for a store archetype (monthly cycle excluded). */
export function blueprintTaskCount(type: BlueprintType): number {
  return BLUEPRINTS[type].reduce((n, b) => n + b.tasks.length, 0);
}

/** Total one-time agency tasks (the weekly rhythm resets, so it's excluded). */
export const AGENCY_TASK_TOTAL = AGENCY_TASK_IDS.size;

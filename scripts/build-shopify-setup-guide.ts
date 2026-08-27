// One-off: build a self-contained "How to subscribe to Shopify" setup guide.
// Screenshots are downscaled and embedded as data URIs so the single .html file
// renders anywhere (emailed, downloaded, shared) with no broken images.
//
// Run:  cd server && bun ../scripts/build-shopify-setup-guide.ts

import path from 'path';
import { createRequire } from 'module';
import fs from 'fs/promises';

const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const requireFromServer = createRequire(path.join(SERVER_DIR, 'package.json'));
const sharp = requireFromServer('sharp');

const DESKTOP = path.resolve(process.env.HOME!, 'Desktop');
const OUT = path.join(DESKTOP, 'shopify-subscribe-setup.html');

// Match a Desktop screenshot by a unique time token (filenames vary in unicode
// normalization of spaces/colons, so we don't hardcode the exact string).
async function findShot(timeToken: string): Promise<string> {
  const entries = await fs.readdir(DESKTOP);
  const hit = entries.find((e) => e.startsWith('Screenshot') && e.includes(timeToken) && e.endsWith('.png'));
  if (!hit) throw new Error(`No screenshot matching "${timeToken}" on Desktop`);
  return hit;
}

async function imgDataUri(file: string, maxWidth = 1280): Promise<string> {
  const buf = await fs.readFile(path.join(DESKTOP, file));
  const out = await sharp(buf)
    .resize({ width: maxWidth, withoutEnlargement: true })
    .png({ quality: 80 })
    .toBuffer();
  return `data:image/png;base64,${out.toString('base64')}`;
}

type Step = { n: number; title: string; lead: string; bullets: string[]; img: string };

async function main() {
  const [home, plans, subscribe] = await Promise.all([
    findShot('7.11.51').then((f) => imgDataUri(f)),
    findShot('7.15.25').then((f) => imgDataUri(f)),
    findShot('7.19.04').then((f) => imgDataUri(f)),
  ]);

  const steps: Step[] = [
    {
      n: 1,
      title: 'Log in to your Shopify account',
      lead: 'Head to Shopify and sign in to your store.',
      bullets: [
        'Go to <a href="https://www.shopify.com/">shopify.com</a> and log in to your account.',
        'On your store’s home screen, click <strong>“Select a plan.”</strong> You’ll find it in the banner at the top, and again in the bottom-left under <strong>Settings</strong> (“Trial ends in 2 days · Subscribe for $1”).',
      ],
      img: home,
    },
    {
      n: 2,
      title: 'Choose the Basic plan',
      lead: 'On the “Select a plan” screen, the Basic plan is the one we want.',
      bullets: [
        'Basic is marked <strong>“Most popular”</strong> and is everything your store needs to get going.',
        'You get the first <strong>3 months for $1/month</strong>, then it’s $25/month.',
        'Click <strong>“Try Basic.”</strong>',
      ],
      img: plans,
    },
    {
      n: 3,
      title: 'Add payment & subscribe',
      lead: 'Last step — confirm how you’ll pay and finish subscribing.',
      bullets: [
        'Pick a payment method (<strong>Shop Pay</strong> or <strong>PayPal</strong>) and add your card or account details.',
        'Check the summary on the right: <strong>Basic plan</strong>, $1/month for 3 months, then $25/month. Amount due today is just <strong>$1</strong>.',
        'Click <strong>“Subscribe.”</strong> That’s it.',
      ],
      img: subscribe,
    },
  ];

  const dateLabel = new Date().toISOString().slice(0, 10);

  const stepCards = steps
    .map(
      (s) => `
    <section class="card step-card">
      <div class="step-head">
        <span class="step-num">${s.n}</span>
        <h2>${s.title}</h2>
      </div>
      <p class="lead">${s.lead}</p>
      <ul class="points">${s.bullets.map((b) => `<li>${b}</li>`).join('')}</ul>
      <figure class="shot">
        <img src="${s.img}" alt="Step ${s.n} — ${s.title}" loading="lazy" />
      </figure>
    </section>`,
    )
    .join('');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>How to subscribe to Shopify — BouldHQ setup guide</title>
<style>
  :root {
    --brand-primary: #A5B4FC;
    --brand-accent:  #A78BFA;
    --brand-success: #34D399;
    --bg:            #0C0C1D;
    --surface:       #13132C;
    --border:        #252554;
    --text:          #E8E8F8;
    --muted:         #8890B4;
    --hairline:      #1C1C3E;
    --radius:        14px;
    --maxw:          820px;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
         font-family: -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif;
         -webkit-font-smoothing: antialiased; color-scheme: dark; }
  .wrap { max-width: var(--maxw); margin: 0 auto; padding: 56px 28px 80px; }
  header.cobrand { display: flex; align-items: center; justify-content: space-between;
    padding-bottom: 28px; margin-bottom: 36px; border-bottom: 1px solid var(--hairline); }
  .cobrand-marks { display: flex; align-items: center; gap: 12px; font-weight: 700; font-size: 20px; }
  .cobrand-marks .store { color: var(--brand-accent); border: 1px solid var(--border);
    background: var(--surface); padding: 4px 14px; border-radius: 999px; font-size: 16px; }
  .cobrand-marks .x { color: var(--muted); font-weight: 400; }
  .cobrand-marks .shopify { color: #95BF47; border: 1px solid var(--border);
    background: var(--surface); padding: 4px 14px; border-radius: 999px; font-size: 16px; }
  header .meta { color: var(--muted); font-size: 12.5px; text-align: right; line-height: 1.55; }
  .title { margin-bottom: 26px; }
  h1 { font-size: 30px; letter-spacing: -0.025em; margin: 0 0 10px; }
  .pill { display: inline-flex; align-items: center; padding: 4px 12px; border-radius: 999px;
    background: rgba(167, 139, 250, 0.18); color: var(--brand-accent); font-size: 12px; font-weight: 600; }
  section.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 22px 26px; margin-bottom: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.5); }
  section.card p { line-height: 1.7; margin: 0 0 10px; }
  section.card a { color: var(--brand-accent); text-decoration: none; }
  .intro h2 { font-size: 15px; font-weight: 700; margin: 0 0 14px; color: var(--brand-primary);
    text-transform: uppercase; letter-spacing: 0.06em; }
  .step-card .step-head { display: flex; align-items: center; gap: 14px; margin-bottom: 6px; }
  .step-num { flex: 0 0 auto; width: 30px; height: 30px; border-radius: 999px; display: inline-flex;
    align-items: center; justify-content: center; font-size: 15px; font-weight: 700;
    background: rgba(167, 139, 250, 0.18); color: var(--brand-accent); }
  .step-card h2 { font-size: 18px; margin: 0; color: var(--text); }
  .step-card .lead { color: var(--muted); margin: 0 0 12px; }
  ul.points { list-style: none; padding: 0; margin: 0 0 18px; }
  ul.points li { position: relative; padding-left: 22px; margin: 0 0 10px; line-height: 1.6; }
  ul.points li:last-child { margin-bottom: 0; }
  ul.points li::before { content: ''; position: absolute; left: 4px; top: 9px; width: 7px; height: 7px;
    border-radius: 999px; background: var(--brand-success); }
  ul.points strong { color: var(--text); }
  figure.shot { margin: 0; border: 1px solid var(--border); border-radius: 10px; overflow: hidden;
    background: #000; }
  figure.shot img { display: block; width: 100%; height: auto; }
  .done { border-color: var(--brand-success); }
  .done h2 { color: var(--brand-success); }
  footer { text-align: center; color: var(--muted); font-size: 11.5px; margin-top: 44px;
    padding-top: 20px; border-top: 1px solid var(--hairline); }
  @media (max-width: 640px) {
    .wrap { padding: 28px 14px 48px; }
    h1 { font-size: 24px; }
    header.cobrand { flex-direction: column; align-items: flex-start; gap: 14px; }
    header .meta { text-align: left; }
    section.card { padding: 18px 16px; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <header class="cobrand">
      <div class="cobrand-marks">
        <span class="store">BouldHQ</span>
        <span class="x">×</span>
        <span class="shopify">Shopify</span>
      </div>
      <div class="meta">Setup guide · ${dateLabel}</div>
    </header>

    <div class="title">
      <h1>How to subscribe to Shopify</h1>
      <span class="pill">3 quick steps</span>
    </div>

    <section class="card intro">
      <h2>Before you start</h2>
      <p>This is a quick, three-step walkthrough to get your store on Shopify’s
      <strong>Basic plan</strong>. It takes a couple of minutes. Subscribing activates your
      plan and gets billing in place — which is what lets us get your <strong>domain</strong>
      set up and going next.</p>
    </section>
${stepCards}

    <section class="card done">
      <h2>You’re all set</h2>
      <p>Once you’ve subscribed, your Basic Shopify plan is active and payment is set up.
      That clears the way for us to get your domain connected and your store fully live.
      Any questions, just reply — we’re here to help.</p>
    </section>

    <footer>
      BouldHQ&nbsp;·&nbsp;Shopify setup guide&nbsp;·&nbsp;${dateLabel}
    </footer>
  </div>
</body>
</html>`;

  await fs.writeFile(OUT, html, 'utf-8');
  const kb = Math.round((await fs.stat(OUT)).size / 1024);
  console.log(`✓ Wrote ${OUT} (${kb} KB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });

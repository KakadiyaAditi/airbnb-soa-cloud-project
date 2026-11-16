import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFrontend = createRequire(join(root, 'frontend/package.json'));
const { chromium } = requireFrontend('@playwright/test');
const base = process.argv[2] || 'http://localhost:8080';
let code = process.env.ADMIN_API_TOKEN;
if (!code) {
  try { code = readFileSync(join(root,'.env'),'utf8').match(/^ADMIN_API_TOKEN=(.+)$/m)?.[1].trim(); } catch {}
}
if (!code) throw Error('Provide the backend manager token privately via ADMIN_API_TOKEN or root .env.');
const browser = await chromium.launch();
let id;
try {
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  const inventory = await fetch(`${base}/api/search?city=London&guests=2`).then(r=>r.json());
  const listing = inventory.data[0]; assert.ok(listing);
  const day = n => new Date(Date.now()+n*86400000).toISOString().slice(0,10);
  await page.goto(base, { waitUntil:'domcontentloaded' });
  await page.getByLabel('Where to?').fill('London');
  await page.getByLabel('Check-in', { exact:true }).fill(day(190));
  await page.getByLabel('Check-out', { exact:true }).fill(day(192));
  await page.locator('#search [name="guests"]').fill('2');
  await page.getByRole('button', { name:'Search stays' }).click();
  await page.getByRole('link').filter({has:page.getByRole('heading',{name:listing.title,exact:true})}).click();
  await page.getByLabel('Full name').fill('Container Smoke Guest');
  await page.getByLabel('Email address').fill('container@example.invalid');
  await page.getByRole('button',{name:'Request to book'}).click();
  await page.getByLabel('Booking reference',{exact:true}).waitFor();
  id = await page.getByLabel('Booking reference',{exact:true}).inputValue();
  const manager = await browser.newPage();
  await manager.goto(`${base}/#/manage`);
  await manager.getByLabel('Management access code').fill(code);
  await manager.getByRole('button',{name:'Open booking manager'}).click();
  await manager.locator('.management-card').filter({hasText:id}).getByRole('button',{name:'Accept request',exact:true}).click();
  await manager.getByRole('button',{name:'Confirm decision'}).click();
  await manager.locator('.management-card').filter({hasText:id}).waitFor({state:'detached'});
  await page.getByRole('button',{name:'Refresh booking status'}).click();
  await page.getByText('Confirmed',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Cancel this booking'}).click();
  await page.getByRole('button',{name:'Yes, cancel booking'}).click();
  await page.getByText('Cancelled',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS actual production-browser search, Nginx same-origin booking, protected manager approval, status refresh and cancellation');
} finally {
  if (id) await fetch(`${base}/api/bookings/${id}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({bookingStatus:'Cancelled'})});
  await browser.close();
}

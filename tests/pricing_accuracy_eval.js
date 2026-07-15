// pricing_accuracy_eval.js
// Runs 7 historical jobs through calcPane() and compares to actual invoiced amounts (column K).
// Source: Cost Breakdowns spreadsheet 5.29.26 — jobs D–J vs target K.

// ── Pricing engine (copied from index.html) ──────────────────────────────────

const PRICE_CATALOG = {
  version: '2026-07-14',
  laborRate: 200,
  sellMultiplier: 3,
  suppliers: {
    busick:    { name: 'Busick',    markup: 1.25,  gridAdder: 5.00 },
    glaz_tech: { name: 'Glaz-Tech', markup: 1.275, gridAdder: 3.75 },
    oldcastle: { name: 'Oldcastle', markup: 1.15,  gridAdder: 2.50 },
  },
  rates: {
    busick: {
      '1/8"':  { clear_ann: 7.72, clear_temp: 11.97, c180_ann: 12.01, c180_temp: 18.53, c270_ann: 12.01, c270_temp: 18.53, c360_ann: 13.90, c360_temp: 20.39 },
      '3/16"': { clear_ann: 8.66, clear_temp: 13.00, c180_ann: 13.98, c180_temp: 19.24, c270_ann: 13.98, c270_temp: 19.24, c360_ann: 15.40, c360_temp: 22.40 },
      '1/4"':  { clear_ann: 8.66, clear_temp: 13.00, c180_ann: null,  c180_temp: null,  c270_ann: 13.98, c270_temp: 19.24, c360_ann: 13.39, c360_temp: 19.48 },
    },
    glaz_tech: {
      '1/8"':  { clear_ann: 9.95,  clear_temp: 11.04, c180_ann: 12.21, c180_temp: 13.66, c270_ann: 12.21, c270_temp: 13.75, c360_ann: 13.89, c360_temp: 15.50 },
      '3/16"': { clear_ann: 11.82, clear_temp: 14.22, c180_ann: 14.13, c180_temp: 16.73, c270_ann: 12.88, c270_temp: 16.58, c360_ann: 15.52, c360_temp: 17.67 },
      '1/4"':  { clear_ann: 11.94, clear_temp: 14.35, c180_ann: 14.22, c180_temp: 16.52, c270_ann: 14.13, c270_temp: 17.76, c360_ann: 15.85, c360_temp: 18.41 },
    },
    oldcastle: {
      '1/8"':  { clear_ann: 8.40, clear_temp: 10.64, c180_ann: 11.82, c180_temp: 14.03, c270_ann: 11.82, c270_temp: 14.06, c360_ann: 13.27, c360_temp: 15.79 },
      '3/16"': { clear_ann: 9.80, clear_temp: 12.04, c180_ann: 12.82, c180_temp: 15.06, c270_ann: 14.78, c270_temp: 17.02, c360_ann: null,  c360_temp: 17.78 },
      '1/4"':  { clear_ann: 8.04, clear_temp:  9.50, c180_ann: 13.94, c180_temp: 16.18, c270_ann: 10.51, c270_temp: 12.54, c360_ann: 12.25, c360_temp: 14.25 },
    },
  },
  shapeMultipliers: {
    standard: 1.00, single_slope: 1.30, double_slope: 1.40,
    radius: 1.50, patterns: 1.50, parallelogram: 2.00,
    circle: 2.00, octagon: 2.00, triple_pane: 1.75,
  },
  glassWeights: {
    '1/8"':  3.28,
    '3/16"': 4.90,
    '1/4"':  6.54,
  },
  weightThresholds: {
    heavy:    75,
    elevated: 50,
  },
};

function calcPaneWeight(pane) {
  if (!pane.width || !pane.height || !pane.thickness) return null;
  const lbsPerSF = PRICE_CATALOG.glassWeights[pane.thickness];
  if (!lbsPerSF) return null;
  return +((pane.width * pane.height) / 144 * lbsPerSF).toFixed(1);
}

function isHeavyLift(pane) {
  const w = calcPaneWeight(pane);
  if (w === null) return false;
  const { heavy, elevated } = PRICE_CATALOG.weightThresholds;
  return w >= heavy || (pane.storyLevel === 'upper' && w >= elevated);
}

function calcPane(pane, supplier) {
  const w_in = parseFloat(pane.width);
  const h_in = parseFloat(pane.height);
  if (!w_in || !h_in || w_in <= 0 || h_in <= 0) return null;
  if (!pane.thickness || !pane.coating || !pane.finish) return null;

  const qty        = pane.qty || 1;
  const SF         = (w_in * h_in) / 144;
  const finishKey  = pane.finish === 'annealed' ? 'ann' : 'temp';
  const coatingKey = pane.coating === 'hardcoat' ? 'c180' : pane.coating;
  const rateKey    = `${coatingKey}_${finishKey}`;
  const sup        = PRICE_CATALOG.suppliers[supplier] || PRICE_CATALOG.suppliers.busick;
  const rawRate    = PRICE_CATALOG.rates[supplier]?.[pane.thickness]?.[rateKey];

  if (rawRate === null || rawRate === undefined) return { requiresQuote: true };

  const gridMode       = pane.grid !== undefined ? pane.grid : (pane.gridEnabled ? 'standard' : 'none');
  const gridAdder      = gridMode !== 'none' ? sup.gridAdder * (pane.shape === 'triple_pane' ? 2 : 1) : 0;
  const customGridFlat = gridMode === 'custom' ? 50 : 0;
  const shapeMult      = PRICE_CATALOG.shapeMultipliers[pane.shape] || 1.0;
  const glassCost      = SF * (rawRate + gridAdder) * shapeMult * sup.markup;
  const laborHrs       = pane.laborHrs ?? 1.0;
  const crewSize       = isHeavyLift(pane) ? 2 : 1;
  const laborCost      = laborHrs * crewSize * PRICE_CATALOG.laborRate;
  const productCost    = +(glassCost * PRICE_CATALOG.sellMultiplier * qty + customGridFlat * qty).toFixed(2);
  const laborTotal     = +(laborCost * qty).toFixed(2);
  const lineTotal      = +(productCost + laborTotal).toFixed(2);

  return { sqft: +(SF * qty).toFixed(4), glassCost: +glassCost.toFixed(2), productCost, laborCost: laborTotal, lineTotal, requiresQuote: false, crewSize };
}

function calcJob(panes, supplier) {
  let totalProduct = 0, totalLabor = 0;
  for (const p of panes) {
    const r = calcPane(p, supplier);
    if (!r || r.requiresQuote) return { requiresQuote: true };
    totalProduct += r.productCost;
    totalLabor   += r.laborCost;
  }
  return { grandTotal: +(totalProduct + totalLabor).toFixed(2), totalProduct: +totalProduct.toFixed(2), totalLabor: +totalLabor.toFixed(2), requiresQuote: false };
}

// ── Job definitions ───────────────────────────────────────────────────────────

const JOBS = [
  {
    estNum: '26626', jobNum: '1972', targetK: 599.00,
    desc: '35¼×42⅝ Clear Ann IG',
    notes: '7/8" OA → 1/8" lite; 1 tech × 1hr',
    panes: [{ width: 36, height: 43, thickness: '1/8"', coating: 'clear', finish: 'annealed', grid: 'none', shape: 'standard', qty: 1, laborHrs: 1.0, unit: 'in' }],
  },
  {
    estNum: '26661', jobNum: '1988', targetK: 550.00,
    desc: '25×15 + 20×25 Triple Pane Clear Ann',
    notes: 'No OA given → 1/8" default; triple_pane 1.75×; labor split 0.75hr/pane (total 1.5hr); 1 tech',
    panes: [
      { width: 25, height: 15, thickness: '1/8"', coating: 'clear', finish: 'annealed', grid: 'none', shape: 'triple_pane', qty: 1, laborHrs: 0.75, unit: 'in' },
      { width: 20, height: 25, thickness: '1/8"', coating: 'clear', finish: 'annealed', grid: 'none', shape: 'triple_pane', qty: 1, laborHrs: 0.75, unit: 'in' },
    ],
  },
  {
    estNum: '26559', jobNum: '1995', targetK: 1549.00,
    desc: '60×59 Grey Temp',
    notes: '1" OA → 1/4" lite; "grey" → obscured (no rate → requiresQuote); proxy shown with clear_temp; 2 techs × 1.5hr = 3.0 laborHrs',
    panes: [{ width: 60, height: 59, thickness: '1/4"', coating: 'obscured', finish: 'tempered', grid: 'none', shape: 'standard', qty: 1, laborHrs: 3.0, unit: 'in' }],
    proxy: [{ width: 60, height: 59, thickness: '1/4"', coating: 'clear', finish: 'tempered', grid: 'none', shape: 'standard', qty: 1, laborHrs: 3.0, unit: 'in' }],
  },
  {
    estNum: '26564', jobNum: '1930', targetK: 699.00,
    desc: '34×58 Double-Coat Low-E Ann Grid',
    notes: '15/16" OA → 1/8" lite (15/16" = two 1/8" lites + spacer); c270 ann confirmed; standard grid; 1 tech × 1.5hr. NOTE: even with correct thickness, product cost alone (~$617) nearly equals target ($699) leaving no room for labor at list price — suspected below-list sale.',
    panes: [{ width: 34, height: 58, thickness: '1/8"', coating: 'c270', finish: 'annealed', grid: 'standard', shape: 'standard', qty: 1, laborHrs: 1.5, unit: 'in' }],
  },
  {
    estNum: '26585', jobNum: '1948', targetK: 549.00,
    desc: '38×41 Clear Ann IG',
    notes: 'No OA given → 1/8" default; rescreen excluded; 1 tech × 1.5hr',
    panes: [{ width: 38, height: 41, thickness: '1/8"', coating: 'clear', finish: 'annealed', grid: 'none', shape: 'standard', qty: 1, laborHrs: 1.5, unit: 'in' }],
  },
  {
    estNum: '26584', jobNum: '1947', targetK: 979.00,
    desc: '40×58 Clear Temp Grid',
    notes: 'No OA given → 1/8" default; standard grid; 2 techs × 1hr = 2.0 laborHrs',
    panes: [{ width: 40, height: 58, thickness: '1/8"', coating: 'clear', finish: 'tempered', grid: 'standard', shape: 'standard', qty: 1, laborHrs: 2.0, unit: 'in' }],
  },
  {
    estNum: '26507', jobNum: '1917', targetK: 789.00,
    desc: '11×53 Hardcoat Ann Grid Triple Pane',
    notes: 'No OA given → 1/8" default; hardcoat → c270 rate; triple_pane 1.75×; standard grid; finish=Ann (N→default); 1 tech × 1hr',
    panes: [{ width: 11, height: 53, thickness: '1/8"', coating: 'hardcoat', finish: 'annealed', grid: 'standard', shape: 'triple_pane', qty: 1, laborHrs: 1.0, unit: 'in' }],
  },
];

// ── Run & report ─────────────────────────────────────────────────────────────

const SUPPLIER = 'busick';
const fmt = n => `$${n.toFixed(2)}`;
const pct = (app, target) => (((app - target) / target) * 100).toFixed(1) + '%';

console.log('\n══════════════════════════════════════════════════════════════════════════════════');
console.log('  FastGlass Pricing Accuracy Evaluation — vs. Column K Actuals (Busick)');
console.log('  Source: Cost Breakdowns 5.29.26 | Supplier: Busick | Date: 2026-07-10');
console.log('══════════════════════════════════════════════════════════════════════════════════\n');

let totalAppPrice = 0, totalTargetK = 0, pricedCount = 0;

for (const job of JOBS) {
  const result = calcJob(job.panes, SUPPLIER);
  const paneDetails = job.panes.map(p => calcPane(p, SUPPLIER));

  console.log(`── Est #${job.estNum}  (Job #${job.jobNum})`);
  console.log(`   ${job.desc}`);
  console.log(`   Assumptions: ${job.notes}`);

  if (result.requiresQuote) {
    console.log(`   App result:  ⚠  REQUIRES QUOTE (coating not in rate table)`);

    // Show proxy if defined
    if (job.proxy) {
      const proxyResult = calcJob(job.proxy, SUPPLIER);
      const proxyPane   = calcPane(job.proxy[0], SUPPLIER);
      if (!proxyResult.requiresQuote) {
        const delta    = proxyResult.grandTotal - job.targetK;
        const sign     = delta >= 0 ? '+' : '';
        console.log(`   Clear proxy: App=${fmt(proxyResult.grandTotal)}  Glass cost=${fmt(proxyPane.glassCost)}  Tier=${proxyPane.tierName}  Labor=${fmt(proxyResult.totalLabor)}`);
        console.log(`   Target K:    ${fmt(job.targetK)}`);
        console.log(`   Delta (proxy vs K): ${sign}${fmt(delta)}  (${sign}${pct(proxyResult.grandTotal, job.targetK)})`);
      }
    }
  } else {
    const glassCosts = paneDetails.map(r => fmt(r.glassCost)).join(' + ');
    const delta      = result.grandTotal - job.targetK;
    const sign       = delta >= 0 ? '+' : '';

    console.log(`   App result:  ${fmt(result.grandTotal)}  (product=${fmt(result.totalProduct)}  labor=${fmt(result.totalLabor)})`);
    console.log(`   Glass cost:  ${glassCosts}`);
    console.log(`   Target K:    ${fmt(job.targetK)}`);
    console.log(`   Delta:       ${sign}${fmt(delta)}  (${sign}${pct(result.grandTotal, job.targetK)})`);

    totalAppPrice  += result.grandTotal;
    totalTargetK   += job.targetK;
    pricedCount++;
  }
  console.log();
}

console.log('══════════════════════════════════════════════════════════════════════════════════');
console.log(`  Jobs priced by app: ${pricedCount} of ${JOBS.length} (1 requires quote — grey/obscured coating)`);
if (pricedCount > 0) {
  const totalDelta = totalAppPrice - totalTargetK;
  const sign = totalDelta >= 0 ? '+' : '';
  console.log(`  Sum — App: ${fmt(totalAppPrice)}  |  Target K: ${fmt(totalTargetK)}  |  Delta: ${sign}${fmt(totalDelta)}  (${sign}${pct(totalAppPrice, totalTargetK)})`);
}
console.log('══════════════════════════════════════════════════════════════════════════════════\n');

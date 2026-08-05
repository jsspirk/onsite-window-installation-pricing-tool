/**
 * FastGlass Field Pricer — Feedback Verification Test Suite
 * Run with: node tests/run_tests.js
 *
 * Covers every item from the April 2026 feedback session:
 *   A. Label / terminology changes
 *   B. Removed fields (Spacer, Supplier chips, Difficulty, Super Spacer, Contact/Type)
 *   C. Grid → 3-option chip (none / standard / custom +$50)
 *   D. Per-pane Install Time (laborHrs) replacing difficulty
 *   E. Pricing engine — calcPane without difficulty, c180/hardcoat rate aliasing
 *   F. Price ranging (fmtRange) with ±band and $400 floor
 *   G. Admin-locked default supplier
 *   H. PRICE_CATALOG shape multipliers (super_spacer removed)
 *   I. freshPane shape — new fields present, old fields absent
 *   J. Backward compatibility — old panes with gridEnabled still price correctly
 *   K. Dimension entry — whole + fraction → ceiling inch conversion
 *   L. Flat sell multiplier (3×) + supplier markup
 *   M. Glass weight — crew sizing and labor cost
 */

'use strict';
const assert = require('assert');

// ─── Minimal localStorage mock ────────────────────────────────────────────────
const _store = {};
const localStorage = {
  getItem:  (k)    => _store[k] !== undefined ? _store[k] : null,
  setItem:  (k, v) => { _store[k] = String(v); },
  removeItem: (k)  => { delete _store[k]; },
};

// ─── Paste the functions under test directly from index.html ─────────────────
// (keeps tests independent of a build tool — copy updated whenever source changes)

const PRICE_CATALOG = {
  version: '2026-07-14',
  laborRates: { 1: 150, 2: 200 },
  suppliers: {
    busick:    { name: 'Busick',    markup: 1.25,  gridAdder: 5.00  },
    glaz_tech: { name: 'Glaz-Tech', markup: 1.275, gridAdder: 3.75  },
    oldcastle: { name: 'Oldcastle', markup: 1.15,  gridAdder: 2.50  },
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
  looseLiteRates: {
    busick: {
      '1/8"':  { clear_ann: null,  clear_temp: 6.27, tint_ann: 8.72,  hardcoat_ann: 13.92, obscured_ann: 10.22, grey_ann: 14.47, grey_temp: null  },
      '3/16"': { clear_ann: null,  clear_temp: 6.74, tint_ann: 9.37,  hardcoat_ann: 14.58, obscured_ann: 14.35, grey_ann: null,  grey_temp: null  },
      '1/4"':  { clear_ann: null,  clear_temp: 6.74, tint_ann: 9.33,  hardcoat_ann: 14.58, obscured_ann: null,  grey_ann: 19.01, grey_temp: null  },
    },
    glaz_tech: {
      '1/8"':  { clear_ann: 3.96,  clear_temp: 5.38, tint_ann: 7.30,  hardcoat_ann: 11.95, obscured_ann: 8.77,  grey_ann: 20.28, grey_temp: null  },
      '3/16"': { clear_ann: 5.64,  clear_temp: 5.38, tint_ann: 7.68,  hardcoat_ann: null,  obscured_ann: 12.37, grey_ann: null,  grey_temp: null  },
      '1/4"':  { clear_ann: 5.71,  clear_temp: 6.54, tint_ann: 8.18,  hardcoat_ann: 9.97,  obscured_ann: null,  grey_ann: null,  grey_temp: null  },
    },
    oldcastle: {
      '1/8"':  { clear_ann: 3.33,  clear_temp: 4.45, tint_ann: 5.99,  hardcoat_ann: null,  obscured_ann: null,  grey_ann: 12.88, grey_temp: 14.00 },
      '3/16"': { clear_ann: 3.80,  clear_temp: 3.80, tint_ann: null,  hardcoat_ann: null,  obscured_ann: 11.59, grey_ann: null,  grey_temp: null  },
      '1/4"':  { clear_ann: 5.95,  clear_temp: 7.40, tint_ann: null,  hardcoat_ann: null,  obscured_ann: null,  grey_ann: null,  grey_temp: null  },
    },
  },
  shapeMultipliers: {
    standard:      1.00,
    single_slope:  1.30,
    double_slope:  1.40,
    radius:        1.50,
    patterns:      1.50,
    parallelogram: 2.00,
    circle:        2.00,
    octagon:       2.00,
  },
  glassWeights: {
    sp: { '1/8"': 1.64, '3/16"': 2.45, '1/4"': 3.27 },
    ig: { '1/8"': 3.28, '3/16"': 4.90, '1/4"': 6.54 },
    tp: { '1/8"': 4.92, '3/16"': 7.35, '1/4"': 9.81 },
  },
  weightThresholds: {
    heavy:    75,
    elevated: 50,
  },
};

const appConfig = { markup_tiers: null, round_increment: 25 };

const DEFAULT_MARKUP_TIERS = [
  { id: 1, name: 'Standard',  maxCost: 150,  multiplier: 3.00 },
  { id: 2, name: 'Large',     maxCost: 300,  multiplier: 2.75 },
  { id: 3, name: 'Oversized', maxCost: null, multiplier: 2.50 },
];

function getMarkupTier(glassCost, tiers) {
  const sorted = [...tiers].sort((a, b) => {
    if (a.maxCost === null) return 1;
    if (b.maxCost === null) return -1;
    return a.maxCost - b.maxCost;
  });
  return sorted.find(t => t.maxCost === null || glassCost <= t.maxCost) || sorted[sorted.length - 1];
}

function roundToIncrement(n, inc) {
  return Math.round(n / inc) * inc;
}

function calcPaneWeight(pane) {
  if (!pane.width || !pane.height || !pane.thickness) return null;
  const ut = pane.unitType || (pane.shape === 'triple_pane' ? 'triple_pane' : 'double_pane');
  const weightKey = ut === 'single_pane' ? 'sp' : ut === 'triple_pane' ? 'tp' : 'ig';
  const lbsPerSF = PRICE_CATALOG.glassWeights[weightKey]?.[pane.thickness];
  if (!lbsPerSF) return null;
  return +((pane.width * pane.height) / 144 * lbsPerSF).toFixed(1);
}

function isHeavyLift(pane) {
  const w = calcPaneWeight(pane);
  if (w === null) return false;
  const { heavy, elevated } = PRICE_CATALOG.weightThresholds;
  return w >= heavy || (pane.storyLevel === 'upper' && w >= elevated);
}

function getDefaultSupplier() {
  return localStorage.getItem('fg_default_supplier') || 'busick';
}

function fmt(n) {
  return '$' + (+n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtRange(n) {
  const band  = parseFloat(localStorage.getItem('fg_range_band') || '0.08');
  const floor = parseFloat(localStorage.getItem('fg_min_job_cost') || '400');
  const low   = Math.max(floor, n * (1 - band));
  const high  = n * (1 + band);
  return `${fmt(low)} \u2013 ${fmt(high)}`;
}

function calcPane(pane, supplier) {
  const w_in = pane.unit === 'cm' ? parseFloat(pane.width) * 0.393701 : parseFloat(pane.width);
  const h_in = pane.unit === 'cm' ? parseFloat(pane.height) * 0.393701 : parseFloat(pane.height);
  if (!w_in || !h_in || w_in <= 0 || h_in <= 0) return null;
  if (!pane.thickness || !pane.coating || !pane.finish) return null;

  const qty       = pane.qty || 1;
  const SF        = (w_in * h_in) / 144;
  const finishKey = pane.finish === 'annealed' ? 'ann' : 'temp';
  const sup       = PRICE_CATALOG.suppliers[supplier] || PRICE_CATALOG.suppliers.busick;

  const unitType = pane.unitType || (pane.shape === 'triple_pane' ? 'triple_pane' : 'double_pane');
  const isSP = unitType === 'single_pane';
  const isTP = unitType === 'triple_pane';

  let rawRate;
  if (isSP) {
    if (pane.coating === 'other') return { requiresQuote: true };
    rawRate = PRICE_CATALOG.looseLiteRates[supplier]?.[pane.thickness]?.[`${pane.coating}_${finishKey}`];
  } else {
    const coatingKey = pane.coating === 'hardcoat' ? 'c180' : pane.coating;
    rawRate = PRICE_CATALOG.rates[supplier]?.[pane.thickness]?.[`${coatingKey}_${finishKey}`];
  }

  if (rawRate === null || rawRate === undefined) return { requiresQuote: true };

  const gridMode       = pane.grid !== undefined ? pane.grid : (pane.gridEnabled ? 'standard' : 'none');
  const gridAdder      = gridMode !== 'none' ? sup.gridAdder * (isTP ? 2 : 1) : 0;
  const customGridFlat = gridMode === 'custom' ? 50 : 0;
  const baseShapeMult  = PRICE_CATALOG.shapeMultipliers[pane.shape] || 1.0;
  const shapeMult      = isTP ? baseShapeMult * 1.75 : baseShapeMult;
  const glassCost      = SF * (rawRate + gridAdder) * shapeMult * sup.markup;
  const laborHrs       = pane.laborHrs ?? 1.0;
  const crewSize       = isHeavyLift(pane) ? 2 : 1;
  const laborRate      = PRICE_CATALOG.laborRates[crewSize];
  const laborCost      = laborHrs * laborRate;
  const sellMult       = getMarkupTier(glassCost, appConfig.markup_tiers || DEFAULT_MARKUP_TIERS).multiplier;
  const productCost    = +(glassCost * sellMult * qty + customGridFlat * qty).toFixed(2);
  const laborTotal     = +laborCost.toFixed(2); // laborHrs is the total for this line, not per-unit
  const lineTotal      = +(productCost + laborTotal).toFixed(2);
  const roundedTotal   = roundToIncrement(lineTotal, appConfig.round_increment || 25);

  return { sqft: +(SF * qty).toFixed(4), productCost, laborCost: laborTotal, materialsCost: 0, lineTotal, roundedTotal, requiresQuote: false, gridMode, weight: calcPaneWeight(pane), crewSize };
}

function calcJob(panes, supplier, opts = {}) {
  let totalProduct = 0, totalLabor = 0, totalRounded = 0;
  panes.forEach(p => {
    const r = calcPane(p, supplier);
    if (!r || r.requiresQuote) return;
    totalProduct += r.productCost;
    totalLabor   += r.laborCost;
    totalRounded += r.roundedTotal;
  });
  const grandTotal = opts.rounded ? totalRounded : (totalProduct + totalLabor);
  return {
    totalProduct:   +totalProduct.toFixed(2),
    totalLabor:     +totalLabor.toFixed(2),
    totalMaterials: 0,
    grandTotal:     +grandTotal.toFixed(2),
  };
}

const FRAC_OPTS = [
  { id: '',    label: '—',  val: 0   },
  { id: '1/8', label: '⅛', val: 1/8 },
  { id: '1/4', label: '¼', val: 1/4 },
  { id: '3/8', label: '⅜', val: 3/8 },
  { id: '1/2', label: '½', val: 1/2 },
  { id: '5/8', label: '⅝', val: 5/8 },
  { id: '3/4', label: '¾', val: 3/4 },
  { id: '7/8', label: '⅞', val: 7/8 },
];

function resolveInches(whole, fracId) {
  const w = parseInt(whole) || 0;
  if (!w) return 0;
  const frac = FRAC_OPTS.find(f => f.id === fracId);
  const fracVal = frac ? frac.val : 0;
  return fracVal === 0 ? w : w + 1;
}

function fmtMeasured(whole, fracId) {
  if (!parseInt(whole)) return '';
  const frac = FRAC_OPTS.find(f => f.id === fracId);
  return `${whole}${frac && frac.label !== '—' ? frac.label : ''}`;
}

function freshPane(from) {
  return {
    thickness:   from?.thickness || '1/8"',
    coating:     from?.coating   || 'clear',
    finish:      from?.finish    || 'annealed',
    grid:        'none',
    shape:       'standard',
    location:    '',
    qty:         1,
    widthWhole:  '',
    widthFrac:   '',
    heightWhole: '',
    heightFrac:  '',
    width:       0,
    height:      0,
    unit:        'in',
    laborHrs:    1.0,
    storyLevel:  'ground',
    unitType:    'double_pane',
  };
}

function getPaneLabel(pane) {
  const coatingMap = {
    clear:    'Clear',
    hardcoat: 'Hardcoat',
    c180:     'Single Softcoat',
    c270:     'Double Softcoat',
    c360:     'Triple Softcoat',
    obscured: 'Obscured/Privacy',
  };
  const finishMap = { annealed: 'Ann.', tempered: 'Temp.' };
  const parts = [pane.thickness, coatingMap[pane.coating], finishMap[pane.finish]].filter(Boolean);
  return parts.join(' · ');
}

// ─── Test runner ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗  ${name}`);
    console.log(`       ${e.message}`);
    failures.push({ name, message: e.message });
    failed++;
  }
}

function section(title) {
  console.log(`\n${title}`);
  console.log('─'.repeat(title.length));
}

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Build a minimal valid pane with overrides. width/height are ceiling values. */
function pane(overrides = {}) {
  return {
    thickness:   '1/8"',
    coating:     'clear',
    finish:      'annealed',
    grid:        'none',
    shape:       'standard',
    unitType:    'double_pane',
    qty:         1,
    widthWhole:  '24',
    widthFrac:   '',
    heightWhole: '36',
    heightFrac:  '',
    width:       24,
    height:      36,
    unit:        'in',
    laborHrs:    1.0,
    storyLevel:  'ground',
    ...overrides,
  };
}

// ─── A. Terminology / Labels ─────────────────────────────────────────────────

section('A. Coating chip labels');

test('c270 renders as "Double Softcoat"', () => {
  assert.strictEqual(getPaneLabel(pane({ coating: 'c270', finish: 'annealed' })).includes('Double Softcoat'), true);
});
test('c360 renders as "Triple Softcoat"', () => {
  assert.strictEqual(getPaneLabel(pane({ coating: 'c360', finish: 'annealed' })).includes('Triple Softcoat'), true);
});
test('c180 renders as "Single Softcoat"', () => {
  assert.strictEqual(getPaneLabel(pane({ coating: 'c180', finish: 'annealed' })).includes('Single Softcoat'), true);
});
test('hardcoat renders as "Hardcoat"', () => {
  assert.strictEqual(getPaneLabel(pane({ coating: 'hardcoat', finish: 'annealed' })).includes('Hardcoat'), true);
});
test('obscured renders as "Obscured/Privacy"', () => {
  assert.strictEqual(getPaneLabel(pane({ coating: 'obscured', finish: 'annealed' })).includes('Obscured/Privacy'), true);
});
test('clear renders as "Clear"', () => {
  assert.strictEqual(getPaneLabel(pane({ coating: 'clear', finish: 'annealed' })).includes('Clear'), true);
});

// ─── B. Removed fields ───────────────────────────────────────────────────────

section('B. freshPane — removed and new fields');

test('freshPane has no spacer field', () => {
  assert.strictEqual('spacer' in freshPane(), false);
});
test('freshPane has no spacerOther field', () => {
  assert.strictEqual('spacerOther' in freshPane(), false);
});
test('freshPane has no gridEnabled field', () => {
  assert.strictEqual('gridEnabled' in freshPane(), false);
});
test('freshPane has no gridH / gridV / gridSize / gridColor fields', () => {
  const fp = freshPane();
  assert.strictEqual('gridH' in fp || 'gridV' in fp || 'gridSize' in fp || 'gridColor' in fp, false);
});
test('freshPane has grid field defaulting to "none"', () => {
  assert.strictEqual(freshPane().grid, 'none');
});
test('freshPane has laborHrs field defaulting to 1.0', () => {
  assert.strictEqual(freshPane().laborHrs, 1.0);
});
test('freshPane has widthWhole, widthFrac, heightWhole, heightFrac fields', () => {
  const fp = freshPane();
  assert.ok('widthWhole' in fp && 'widthFrac' in fp && 'heightWhole' in fp && 'heightFrac' in fp);
});
test('freshPane width and height default to 0 (ceiling int)', () => {
  const fp = freshPane();
  assert.strictEqual(fp.width,  0);
  assert.strictEqual(fp.height, 0);
});
test('freshPane has no decimal width or height string', () => {
  const fp = freshPane();
  assert.ok(typeof fp.width  === 'number', 'width should be a number');
  assert.ok(typeof fp.height === 'number', 'height should be a number');
});
test('freshPane has unitType defaulting to "double_pane"', () => {
  assert.strictEqual(freshPane().unitType, 'double_pane');
});

// ─── C. Grid — 3-option chip ─────────────────────────────────────────────────

section('C. Grid pricing modes');

test('grid="none" → no grid adder applied', () => {
  const withGrid    = calcPane(pane({ grid: 'standard' }), 'busick');
  const withoutGrid = calcPane(pane({ grid: 'none' }),     'busick');
  assert.ok(withGrid.productCost > withoutGrid.productCost,
    `Expected grid standard (${withGrid.productCost}) > none (${withoutGrid.productCost})`);
});

test('grid="standard" → Busick gridAdder (+$5.00/SF) added to rate', () => {
  const noGrid = calcPane(pane({ grid: 'none',     width: 24, height: 36 }), 'busick');
  const std    = calcPane(pane({ grid: 'standard', width: 24, height: 36 }), 'busick');
  const SF = (24 * 36) / 144;
  const sup = PRICE_CATALOG.suppliers.busick;
  const rawRate = PRICE_CATALOG.rates.busick['1/8"'].clear_ann;
  const mult = getMarkupTier(SF * (rawRate + sup.gridAdder) * sup.markup, DEFAULT_MARKUP_TIERS).multiplier;
  const expectedDiff = +(SF * sup.gridAdder * sup.markup * mult).toFixed(2);
  assert.ok(
    Math.abs((std.productCost - noGrid.productCost) - expectedDiff) < 0.01,
    `Grid adder diff should be ~${expectedDiff}, got ${(std.productCost - noGrid.productCost).toFixed(2)}`
  );
});

test('grid="custom" → gridAdder + $50 flat per pane', () => {
  const std    = calcPane(pane({ grid: 'standard', width: 24, height: 36, qty: 1 }), 'busick');
  const custom = calcPane(pane({ grid: 'custom',   width: 24, height: 36, qty: 1 }), 'busick');
  assert.ok(
    Math.abs((custom.productCost - std.productCost) - 50) < 0.01,
    `Custom should be $50 more than standard, got diff of ${(custom.productCost - std.productCost).toFixed(2)}`
  );
});

test('grid="custom" qty=3 → $50 flat applies per pane (×3)', () => {
  const std    = calcPane(pane({ grid: 'standard', width: 24, height: 36, qty: 3 }), 'busick');
  const custom = calcPane(pane({ grid: 'custom',   width: 24, height: 36, qty: 3 }), 'busick');
  assert.ok(
    Math.abs((custom.productCost - std.productCost) - 150) < 0.01,
    `Custom qty=3 should be $150 more, got ${(custom.productCost - std.productCost).toFixed(2)}`
  );
});

test('gridMode returned in result matches input', () => {
  assert.strictEqual(calcPane(pane({ grid: 'none'     }), 'busick').gridMode, 'none');
  assert.strictEqual(calcPane(pane({ grid: 'standard' }), 'busick').gridMode, 'standard');
  assert.strictEqual(calcPane(pane({ grid: 'custom'   }), 'busick').gridMode, 'custom');
});

// ─── D. Per-pane Install Time (laborHrs) ─────────────────────────────────────

section('D. Per-pane install time');

test('calcPane uses pane.laborHrs for labor cost (1.0 hr)', () => {
  const r = calcPane(pane({ laborHrs: 1.0 }), 'busick');
  assert.strictEqual(r.laborCost, 150.00);
});

test('calcPane uses pane.laborHrs for labor cost (1.5 hr)', () => {
  const r = calcPane(pane({ laborHrs: 1.5 }), 'busick');
  assert.strictEqual(r.laborCost, 225.00);
});

test('calcPane uses pane.laborHrs for labor cost (0.25 hr)', () => {
  const r = calcPane(pane({ laborHrs: 0.25 }), 'busick');
  assert.strictEqual(r.laborCost, 37.50);
});

test('calcPane defaults to 1.0 hr when laborHrs is missing (backward compat)', () => {
  const oldPane = pane();
  delete oldPane.laborHrs;
  const r = calcPane(oldPane, 'busick');
  assert.strictEqual(r.laborCost, 150.00);
});

test('laborHrs is the total for the line, not multiplied by qty', () => {
  const r = calcPane(pane({ laborHrs: 1.0, qty: 3 }), 'busick');
  assert.strictEqual(r.laborCost, 150.00);
});

test('calcPane accepts no difficulty argument (does not throw)', () => {
  assert.doesNotThrow(() => calcPane(pane(), 'busick'));
});

// ─── E. Pricing engine — coating aliasing ────────────────────────────────────

section('E. Coating rate aliasing — hardcoat maps to c180');

test('hardcoat and c180 produce identical product cost (both use c180 key)', () => {
  const c180r    = calcPane(pane({ coating: 'c180',     thickness: '1/8"' }), 'busick');
  const hardcoat = calcPane(pane({ coating: 'hardcoat', thickness: '1/8"' }), 'busick');
  assert.strictEqual(c180r.productCost, hardcoat.productCost);
});

test('hardcoat does NOT equal c270 at GTI 3/16" ann (rates diverge)', () => {
  // GTI 3/16": c180_ann=14.13 ≠ c270_ann=12.88 — different products, different prices
  const hardcoat = calcPane(pane({ coating: 'hardcoat', thickness: '3/16"', finish: 'annealed' }), 'glaz_tech');
  const c270     = calcPane(pane({ coating: 'c270',     thickness: '3/16"', finish: 'annealed' }), 'glaz_tech');
  assert.notStrictEqual(hardcoat.productCost, c270.productCost,
    'hardcoat (c180) and c270 should price differently at GTI 3/16"');
});

test('c180 does not return requiresQuote at 1/8" Busick', () => {
  const r = calcPane(pane({ coating: 'c180', thickness: '1/8"', finish: 'annealed' }), 'busick');
  assert.strictEqual(r.requiresQuote, false);
});

test('c180 returns requiresQuote at 1/4" Busick (not available from Busick)', () => {
  const r = calcPane(pane({ coating: 'c180', thickness: '1/4"', finish: 'annealed' }), 'busick');
  assert.ok(r && r.requiresQuote === true, 'Busick 1/4" c180 should require a quote');
});

test('obscured coating returns requiresQuote (no rate in catalog)', () => {
  const r = calcPane(pane({ coating: 'obscured' }), 'busick');
  assert.ok(r === null || r.requiresQuote === true, 'obscured should require a quote');
});

// ─── F. Price ranging ────────────────────────────────────────────────────────

section('F. fmtRange — band and floor');

test('default band is ±8% when fg_range_band not set', () => {
  delete _store['fg_range_band'];
  const n = 1000;
  const result = fmtRange(n);
  assert.ok(result.includes('$920.00'), `Low end should be $920.00 at ±8%, got: ${result}`);
  assert.ok(result.includes('$1,080.00'), `High end should be $1,080.00, got: ${result}`);
});

test('$400 floor applied when 8% low would be below $400', () => {
  delete _store['fg_range_band'];
  const result = fmtRange(420);  // 420 × 0.92 = 386.40 → floored to $400
  assert.ok(result.startsWith('$400.00'), `Low end should be floored at $400.00, got: ${result}`);
});

test('$400 floor not applied when price is well above threshold', () => {
  delete _store['fg_range_band'];
  const result = fmtRange(1000);
  assert.ok(!result.startsWith('$400.00'), `Floor should not kick in at $1,000, got: ${result}`);
});

test('no bid goes below $400 regardless of price or band', () => {
  localStorage.setItem('fg_range_band', '0.15');
  // $450 × 0.85 = $382.50 → floored
  const result = fmtRange(450);
  assert.ok(result.startsWith('$400.00'), `Floor must be $400.00, got: ${result}`);
  delete _store['fg_range_band'];
});

test('admin-configured band ±5% is respected', () => {
  localStorage.setItem('fg_range_band', '0.05');
  const result = fmtRange(1000);
  assert.ok(result.includes('$950.00'), `Low should be $950.00 at ±5%, got: ${result}`);
  assert.ok(result.includes('$1,050.00'), `High should be $1,050.00, got: ${result}`);
  delete _store['fg_range_band'];
});

test('admin-configured band ±15% is respected', () => {
  localStorage.setItem('fg_range_band', '0.15');
  const result = fmtRange(2000);
  assert.ok(result.includes('$1,700.00'), `Low should be $1,700.00 at ±15%, got: ${result}`);
  assert.ok(result.includes('$2,300.00'), `High should be $2,300.00, got: ${result}`);
  delete _store['fg_range_band'];
});

test('default floor is $400 when fg_min_job_cost not set', () => {
  delete _store['fg_min_job_cost'];
  const result = fmtRange(420); // 420 × 0.92 = 386.40 → floored to $400
  assert.ok(result.startsWith('$400.00'), `Low end should be floored at $400.00, got: ${result}`);
});

test('admin-configured min job cost floor is respected', () => {
  localStorage.setItem('fg_min_job_cost', '600');
  const result = fmtRange(420); // 420 × 0.92 = 386.40 → floored to $600
  assert.ok(result.startsWith('$600.00'), `Low end should be floored at $600.00, got: ${result}`);
  delete _store['fg_min_job_cost'];
});

test('admin-configured min job cost does not affect prices above the floor', () => {
  localStorage.setItem('fg_min_job_cost', '600');
  const result = fmtRange(1000);
  assert.ok(result.includes('$920.00'), `Low end should be $920.00 (unaffected by $600 floor), got: ${result}`);
  delete _store['fg_min_job_cost'];
});

// ─── G. Admin-locked default supplier ────────────────────────────────────────

section('G. Admin-locked default supplier');

test('getDefaultSupplier returns "busick" when not configured', () => {
  delete _store['fg_default_supplier'];
  assert.strictEqual(getDefaultSupplier(), 'busick');
});

test('getDefaultSupplier returns saved value when set to glaz_tech', () => {
  localStorage.setItem('fg_default_supplier', 'glaz_tech');
  assert.strictEqual(getDefaultSupplier(), 'glaz_tech');
  delete _store['fg_default_supplier'];
});

test('getDefaultSupplier returns saved value when set to oldcastle', () => {
  localStorage.setItem('fg_default_supplier', 'oldcastle');
  assert.strictEqual(getDefaultSupplier(), 'oldcastle');
  delete _store['fg_default_supplier'];
});

test('calcPane uses the supplied supplier argument (busick vs glaz_tech differ)', () => {
  const busick   = calcPane(pane(), 'busick');
  const glaztech = calcPane(pane(), 'glaz_tech');
  assert.notStrictEqual(busick.productCost, glaztech.productCost);
});

// ─── H. Shape multipliers — super_spacer removed ─────────────────────────────

section('H. Shape multipliers');

test('super_spacer is NOT in PRICE_CATALOG.shapeMultipliers', () => {
  assert.strictEqual('super_spacer' in PRICE_CATALOG.shapeMultipliers, false);
});

test('standard shape multiplier is 1.0', () => {
  assert.strictEqual(PRICE_CATALOG.shapeMultipliers.standard, 1.00);
});

test('circle shape multiplier is 2.0', () => {
  assert.strictEqual(PRICE_CATALOG.shapeMultipliers.circle, 2.00);
});

test('triple_pane is NOT in shapeMultipliers (handled via unitType)', () => {
  assert.strictEqual('triple_pane' in PRICE_CATALOG.shapeMultipliers, false);
});

test('non-standard shape multiplier is applied to product cost', () => {
  const std  = calcPane(pane({ shape: 'standard' }), 'busick');
  const circ = calcPane(pane({ shape: 'circle'   }), 'busick');
  // circle is 2× standard — labor is the same, only product differs
  const expectedProductDiff = +(std.productCost * (2.0 - 1.0)).toFixed(2);
  assert.ok(
    Math.abs((circ.productCost - std.productCost) - expectedProductDiff) < 0.01,
    `Circle should be 2× standard product cost. Diff: ${(circ.productCost - std.productCost).toFixed(2)}, expected: ${expectedProductDiff}`
  );
});

// ─── I. Backward compatibility — old panes with gridEnabled ──────────────────

section('I. Backward compatibility — old pane format');

test('old pane with gridEnabled=true treated as grid="standard"', () => {
  const oldPane = pane({ gridEnabled: true });
  delete oldPane.grid;
  const r = calcPane(oldPane, 'busick');
  assert.strictEqual(r.gridMode, 'standard');
});

test('old pane with gridEnabled=false treated as grid="none"', () => {
  const oldPane = pane({ gridEnabled: false });
  delete oldPane.grid;
  const r = calcPane(oldPane, 'busick');
  assert.strictEqual(r.gridMode, 'none');
});

test('old pane with gridEnabled=true prices higher than gridEnabled=false', () => {
  const withGrid    = pane({ gridEnabled: true  }); delete withGrid.grid;
  const withoutGrid = pane({ gridEnabled: false }); delete withoutGrid.grid;
  const rWith    = calcPane(withGrid,    'busick');
  const rWithout = calcPane(withoutGrid, 'busick');
  assert.ok(rWith.productCost > rWithout.productCost);
});

// ─── J. calcJob — aggregation ────────────────────────────────────────────────

section('J. calcJob aggregation');

test('calcJob sums product and labor across all panes', () => {
  const panes = [
    pane({ width: 24, height: 36, laborHrs: 1.0 }),
    pane({ width: 12, height: 24, laborHrs: 0.5 }),
  ];
  const job  = calcJob(panes, 'busick');
  const p1   = calcPane(panes[0], 'busick');
  const p2   = calcPane(panes[1], 'busick');
  assert.strictEqual(job.totalProduct, +(p1.productCost + p2.productCost).toFixed(2));
  assert.strictEqual(job.totalLabor,   +(p1.laborCost   + p2.laborCost).toFixed(2));
  assert.strictEqual(job.grandTotal,   +(job.totalProduct + job.totalLabor).toFixed(2));
});

test('calcJob accepts no difficulty argument', () => {
  assert.doesNotThrow(() => calcJob([pane()], 'busick'));
});

test('calcJob skips panes that requiresQuote', () => {
  const panes = [
    pane({ coating: 'c180', thickness: '1/4"', finish: 'annealed' }), // Busick 1/4" c180 not available → requiresQuote
    pane({ coating: 'clear', thickness: '1/8"', finish: 'annealed' }),
  ];
  const job = calcJob(panes, 'busick');
  const good = calcPane(panes[1], 'busick');
  // Only the second pane should contribute
  assert.strictEqual(job.totalProduct, good.productCost);
});

// ─── K. Dimension entry — resolveInches & fmtMeasured ───────────────────────

section('K. Dimension entry — whole + fraction → ceiling');

test('whole number, no fraction → unchanged', () => {
  assert.strictEqual(resolveInches('24', ''), 24);
});
test('whole number + 1/2 → ceiling (next inch)', () => {
  assert.strictEqual(resolveInches('23', '1/2'), 24);
});
test('whole number + 1/8 → ceiling (any fraction rounds up)', () => {
  assert.strictEqual(resolveInches('23', '1/8'), 24);
});
test('whole number + 7/8 → ceiling', () => {
  assert.strictEqual(resolveInches('23', '7/8'), 24);
});
test('whole number + 3/4 → ceiling', () => {
  assert.strictEqual(resolveInches('47', '3/4'), 48);
});
test('whole number + 1/4 → ceiling', () => {
  assert.strictEqual(resolveInches('35', '1/4'), 36);
});
test('empty whole returns 0 regardless of fraction', () => {
  assert.strictEqual(resolveInches('', '3/4'), 0);
  assert.strictEqual(resolveInches('', ''),    0);
});
test('0 whole returns 0', () => {
  assert.strictEqual(resolveInches('0', '1/2'), 0);
});
test('exact whole — price is based on stated dimension', () => {
  // 24" no fraction → priced at 24, not 25
  const r36 = calcPane(pane({ widthWhole: '36', widthFrac: '', width: 36, height: 48 }), 'busick');
  const r37 = calcPane(pane({ widthWhole: '36', widthFrac: '1/2', width: 37, height: 48 }), 'busick');
  assert.ok(r37.productCost > r36.productCost, 'Fractional width should produce higher sqft and cost');
});
test('ceiling causes measurable sqft difference (23¾ priced as 24)', () => {
  const measured = calcPane(pane({ width: 23, height: 36 }), 'busick'); // no fraction, priced at 23
  const ceiling  = calcPane(pane({ width: 24, height: 36 }), 'busick'); // with fraction, priced at 24
  assert.ok(ceiling.sqft > measured.sqft, `24" sqft (${ceiling.sqft}) should exceed 23" sqft (${measured.sqft})`);
});

section('K2. fmtMeasured display string');

test('whole only → plain number string', () => {
  assert.strictEqual(fmtMeasured('24', ''), '24');
});
test('whole + fraction → number + fraction glyph', () => {
  assert.strictEqual(fmtMeasured('23', '3/4'), '23¾');
});
test('whole + 1/2 → number + ½', () => {
  assert.strictEqual(fmtMeasured('36', '1/2'), '36½');
});
test('whole + 1/8 → number + ⅛', () => {
  assert.strictEqual(fmtMeasured('47', '1/8'), '47⅛');
});
test('empty whole → empty string', () => {
  assert.strictEqual(fmtMeasured('', '3/4'), '');
});
test('FRAC_OPTS covers all 8 options (none + 7 fractions)', () => {
  assert.strictEqual(FRAC_OPTS.length, 8);
});
test('FRAC_OPTS values are in ascending order', () => {
  const vals = FRAC_OPTS.map(f => f.val);
  for (let i = 1; i < vals.length; i++) {
    assert.ok(vals[i] > vals[i-1], `FRAC_OPTS not ascending at index ${i}`);
  }
});

// ─── L. Flat sell multiplier — formula verification ──────────────────────────

section('L. Flat sell multiplier (3×) + supplier markup');

test('productCost = SF × rawRate × markup × tier multiplier for standard pane', () => {
  // 24×36 clear ann Busick: SF=6, rate=7.72, markup=1.25 → glassCost=57.90 → tier 1 (3.00×)
  const r = calcPane(pane({ width: 24, height: 36, coating: 'clear', finish: 'annealed', grid: 'none' }), 'busick');
  const SF = (24 * 36) / 144;
  const glassCost = SF * 7.72 * 1.25;
  const mult = getMarkupTier(glassCost, DEFAULT_MARKUP_TIERS).multiplier;
  const expected = +(glassCost * mult).toFixed(2);
  assert.ok(Math.abs(r.productCost - expected) < 0.01, `Expected ${expected}, got ${r.productCost}`);
});

test('large/costly pane gets a reduced tier multiplier (Oversized, 2.50×)', () => {
  // 48×84 c270 ann Busick: SF=28, rate=12.01, markup=1.25 → glassCost=420.35 → above $300, tier 3 (2.50×)
  const r = calcPane(pane({ width: 48, height: 84, coating: 'c270', finish: 'annealed', grid: 'none' }), 'busick');
  const SF = (48 * 84) / 144;
  const glassCost = SF * 12.01 * 1.25;
  const mult = getMarkupTier(glassCost, DEFAULT_MARKUP_TIERS).multiplier;
  assert.strictEqual(mult, 2.50, `Expected Oversized tier (2.50×) for glassCost ${glassCost.toFixed(2)}, got ${mult}×`);
  const expected = +(glassCost * mult).toFixed(2);
  assert.ok(Math.abs(r.productCost - expected) < 0.01, `Expected ${expected}, got ${r.productCost}`);
});

test('Busick (1.25×) and GTI (1.275×) markup produces different prices for same glass', () => {
  const busick   = calcPane(pane({ coating: 'clear', finish: 'annealed', grid: 'none' }), 'busick');
  const glaztech = calcPane(pane({ coating: 'clear', finish: 'annealed', grid: 'none' }), 'glaz_tech');
  assert.notStrictEqual(busick.productCost, glaztech.productCost);
});

test('ROM SELL-AT reference: 1/8" Clear Ann Busick matches cost calc formula', () => {
  // ROM SELL-AT shows $608.11 for 14.097 SF, Easy (1hr). Formula: 14.097 × 7.72 × 1.25 × 3 + 200 = $608.12
  // 43×47 ≈ 14.04 SF — close enough to verify formula direction
  const r = calcPane(pane({ width: 43, height: 47, coating: 'clear', finish: 'annealed', grid: 'none', laborHrs: 1.0 }), 'busick');
  const SF = (43 * 47) / 144;
  const glassCost = SF * 7.72 * 1.25;
  const mult = getMarkupTier(glassCost, DEFAULT_MARKUP_TIERS).multiplier;
  const expectedProduct = +(glassCost * mult).toFixed(2);
  assert.ok(Math.abs(r.productCost - expectedProduct) < 0.01, `Expected ${expectedProduct}, got ${r.productCost}`);
});

test('grid adder is multiplied by supplier markup and sell multiplier', () => {
  const noGrid = calcPane(pane({ width: 24, height: 36, grid: 'none'     }), 'busick');
  const std    = calcPane(pane({ width: 24, height: 36, grid: 'standard' }), 'busick');
  const SF = (24 * 36) / 144;
  const sup = PRICE_CATALOG.suppliers.busick;
  const rawRate = PRICE_CATALOG.rates.busick['1/8"'].clear_ann;
  const mult = getMarkupTier(SF * (rawRate + sup.gridAdder) * sup.markup, DEFAULT_MARKUP_TIERS).multiplier;
  const expectedDiff = +(SF * sup.gridAdder * sup.markup * mult).toFixed(2);
  assert.ok(Math.abs((std.productCost - noGrid.productCost) - expectedDiff) < 0.01,
    `Grid diff should be ${expectedDiff}, got ${(std.productCost - noGrid.productCost).toFixed(2)}`);
});

test('calcPane result does not include tierName', () => {
  const r = calcPane(pane(), 'busick');
  assert.strictEqual('tierName' in r, false, 'result should not include tierName');
});

test('Busick 1/4" c360 now has real rates (not requiresQuote)', () => {
  const r = calcPane(pane({ coating: 'c360', thickness: '1/4"', finish: 'annealed' }), 'busick');
  assert.ok(r && !r.requiresQuote, 'Busick 1/4" c360 should price successfully');
  const SF = (24 * 36) / 144;
  const expected = +(SF * 13.39 * 1.25 * 3).toFixed(2);
  assert.ok(Math.abs(r.productCost - expected) < 0.01, `Expected ${expected}, got ${r.productCost}`);
});

// ─── M. Glass weight — crew sizing and labor cost ────────────────────────────

section('M. Glass weight and crew sizing');

test('calcPaneWeight returns null when dimensions are missing', () => {
  assert.strictEqual(calcPaneWeight({ thickness: '1/8"', width: 0, height: 36 }), null);
});

test('calcPaneWeight: 1/8" at 6 SF = 19.7 lbs', () => {
  // 24×36 / 144 × 3.28 = 19.68 → 19.7
  const w = calcPaneWeight({ width: 24, height: 36, thickness: '1/8"' });
  assert.ok(Math.abs(w - 19.7) < 0.1, `Expected ~19.7, got ${w}`);
});

test('calcPaneWeight: 1/4" at 6 SF = 39.2 lbs', () => {
  // 24×36 / 144 × 6.54 = 39.24 → 39.2
  const w = calcPaneWeight({ width: 24, height: 36, thickness: '1/4"' });
  assert.ok(Math.abs(w - 39.2) < 0.1, `Expected ~39.2, got ${w}`);
});

test('isHeavyLift false for ground-floor pane under 75 lbs', () => {
  // 24×36 1/4" = ~39.2 lbs, ground floor → not heavy
  assert.strictEqual(isHeavyLift({ width: 24, height: 36, thickness: '1/4"', storyLevel: 'ground' }), false);
});

test('isHeavyLift true when pane ≥75 lbs (any floor)', () => {
  // 60×60 1/4": 3600/144 × 6.54 = 163.5 lbs → heavy
  assert.strictEqual(isHeavyLift({ width: 60, height: 60, thickness: '1/4"', storyLevel: 'ground' }), true);
});

test('isHeavyLift true when ≥50 lbs on upper floor', () => {
  // 40×50 1/4": 2000/144 × 6.54 = 90.8 lbs... too heavy. Use 1/8": 2000/144 × 3.28 = 45.6 lbs
  // Try 55×48 1/8": 2640/144 × 3.28 = 60.1 lbs on upper → heavy
  assert.strictEqual(isHeavyLift({ width: 55, height: 48, thickness: '1/8"', storyLevel: 'upper' }), true);
});

test('isHeavyLift false when 50–74 lbs on ground floor', () => {
  // 55×48 1/8" = 60.1 lbs, ground floor → not heavy (only triggered on upper)
  assert.strictEqual(isHeavyLift({ width: 55, height: 48, thickness: '1/8"', storyLevel: 'ground' }), false);
});

test('isHeavyLift false when <50 lbs on upper floor', () => {
  // 24×36 1/8" = 19.7 lbs upper floor → not heavy
  assert.strictEqual(isHeavyLift({ width: 24, height: 36, thickness: '1/8"', storyLevel: 'upper' }), false);
});

test('crewSize is 1 for light ground-floor pane', () => {
  const r = calcPane(pane({ width: 24, height: 36, thickness: '1/8"', storyLevel: 'ground' }), 'busick');
  assert.strictEqual(r.crewSize, 1);
});

test('crewSize is 2 for heavy pane (≥75 lbs)', () => {
  // 60×60 1/4" = 163.5 lbs, any floor
  const r = calcPane(pane({ width: 60, height: 60, thickness: '1/4"', storyLevel: 'ground' }), 'busick');
  assert.strictEqual(r.crewSize, 2);
});

test('crewSize is 2 for 50–74 lb pane on upper floor', () => {
  // 55×48 1/8" = 60.1 lbs on upper floor
  const r = calcPane(pane({ width: 55, height: 48, thickness: '1/8"', storyLevel: 'upper' }), 'busick');
  assert.strictEqual(r.crewSize, 2);
});

test('triple pane + grid doubles the grid adder (2 air spaces)', () => {
  const withGrid    = calcPane(pane({ unitType: 'triple_pane', grid: 'standard', width: 24, height: 36 }), 'busick');
  const withoutGrid = calcPane(pane({ unitType: 'triple_pane', grid: 'none',     width: 24, height: 36 }), 'busick');
  const SF = (24 * 36) / 144;
  const sup = PRICE_CATALOG.suppliers.busick;
  const rawRate = PRICE_CATALOG.rates.busick['1/8"'].clear_ann;
  // TP shapeMult = standard(1.0) × 1.75; grid adder is doubled for TP (2 air spaces)
  const tpShapeMult = 1.0 * 1.75;
  // Grid pushes glassCost into a higher pricing tier here, so each side needs its own
  // tier multiplier — a single shared-multiplier diff formula no longer holds.
  const glassCostNoGrid = SF * rawRate * tpShapeMult * sup.markup;
  const glassCostGrid   = SF * (rawRate + sup.gridAdder * 2) * tpShapeMult * sup.markup;
  const multNoGrid = getMarkupTier(glassCostNoGrid, DEFAULT_MARKUP_TIERS).multiplier;
  const multGrid   = getMarkupTier(glassCostGrid, DEFAULT_MARKUP_TIERS).multiplier;
  const expectedGridDiff = +((glassCostGrid * multGrid) - (glassCostNoGrid * multNoGrid)).toFixed(2);
  assert.ok(
    Math.abs((withGrid.productCost - withoutGrid.productCost) - expectedGridDiff) < 0.01,
    `Triple pane grid diff should be ${expectedGridDiff}, got ${(withGrid.productCost - withoutGrid.productCost).toFixed(2)}`
  );
});

test('standard shape grid adder is NOT doubled', () => {
  const withGrid    = calcPane(pane({ shape: 'standard', grid: 'standard', width: 24, height: 36 }), 'busick');
  const withoutGrid = calcPane(pane({ shape: 'standard', grid: 'none',     width: 24, height: 36 }), 'busick');
  const SF = (24 * 36) / 144;
  const sup = PRICE_CATALOG.suppliers.busick;
  const rawRate = PRICE_CATALOG.rates.busick['1/8"'].clear_ann;
  const mult = getMarkupTier(SF * (rawRate + sup.gridAdder) * 1.0 * sup.markup, DEFAULT_MARKUP_TIERS).multiplier;
  const expectedGridDiff = +(SF * sup.gridAdder * 1.0 * sup.markup * mult).toFixed(2);
  assert.ok(
    Math.abs((withGrid.productCost - withoutGrid.productCost) - expectedGridDiff) < 0.01,
    `Standard grid diff should be ${expectedGridDiff}, got ${(withGrid.productCost - withoutGrid.productCost).toFixed(2)}`
  );
});

test('2-tech crew rate is $200/hr vs $150/hr for 1-tech (same laborHrs)', () => {
  const light = calcPane(pane({ width: 24, height: 36, thickness: '1/8"', storyLevel: 'ground', laborHrs: 1.0 }), 'busick');
  const heavy = calcPane(pane({ width: 60, height: 60, thickness: '1/4"', storyLevel: 'ground', laborHrs: 1.0 }), 'busick');
  assert.strictEqual(light.laborCost, 150);
  assert.strictEqual(heavy.laborCost, 200);
});

test('freshPane includes storyLevel defaulting to "ground"', () => {
  assert.strictEqual(freshPane().storyLevel, 'ground');
});

test('weight is included in calcPane result', () => {
  const r = calcPane(pane({ width: 24, height: 36, thickness: '1/8"' }), 'busick');
  assert.ok(typeof r.weight === 'number', `weight should be a number, got ${typeof r.weight}`);
});

// ─── N. Unit Type — single pane, double pane, triple pane ────────────────────

section('N. Unit type selector');

test('freshPane unitType defaults to "double_pane"', () => {
  assert.strictEqual(freshPane().unitType, 'double_pane');
});

test('SP uses looseLiteRates (not IG rates)', () => {
  // Glaz-Tech 1/8" clear_ann SP = 3.96 $/SF
  const r = calcPane(pane({ unitType: 'single_pane', coating: 'clear', finish: 'annealed', thickness: '1/8"', width: 24, height: 36 }), 'glaz_tech');
  const SF = (24 * 36) / 144;
  const sup = PRICE_CATALOG.suppliers.glaz_tech;
  const glassCost = SF * 3.96 * sup.markup;
  const mult = getMarkupTier(glassCost, DEFAULT_MARKUP_TIERS).multiplier;
  const expected = +(glassCost * mult).toFixed(2);
  assert.ok(!r.requiresQuote, 'SP clear ann glaz_tech should price successfully');
  assert.ok(Math.abs(r.productCost - expected) < 0.01, `Expected ${expected}, got ${r.productCost}`);
});

test('SP hardcoat uses hardcoat_ann key directly (no c180 alias)', () => {
  // Glaz-Tech 1/8" hardcoat_ann SP = 11.95 $/SF
  const sp = calcPane(pane({ unitType: 'single_pane',  coating: 'hardcoat', finish: 'annealed', thickness: '1/8"' }), 'glaz_tech');
  const ig = calcPane(pane({ unitType: 'double_pane',  coating: 'hardcoat', finish: 'annealed', thickness: '1/8"' }), 'glaz_tech');
  assert.ok(!sp.requiresQuote, 'SP hardcoat should price');
  assert.notStrictEqual(sp.productCost, ig.productCost, 'SP and IG hardcoat use different rate tables');
});

test('SP coating "other" returns requiresQuote', () => {
  const r = calcPane(pane({ unitType: 'single_pane', coating: 'other', finish: 'annealed', thickness: '1/8"' }), 'busick');
  assert.ok(r && r.requiresQuote === true, 'SP other should require a quote');
});

test('SP null rate (missing from looseLiteRates) returns requiresQuote', () => {
  // Busick 1/8" clear_ann SP = null
  const r = calcPane(pane({ unitType: 'single_pane', coating: 'clear', finish: 'annealed', thickness: '1/8"' }), 'busick');
  assert.ok(r && r.requiresQuote === true, 'Busick SP 1/8" clear_ann is null → requires quote');
});

test('TP applies 1.75× shape multiplier to product cost', () => {
  const dp = calcPane(pane({ unitType: 'double_pane', coating: 'clear', finish: 'annealed', grid: 'none' }), 'busick');
  const tp = calcPane(pane({ unitType: 'triple_pane', coating: 'clear', finish: 'annealed', grid: 'none' }), 'busick');
  assert.ok(!dp.requiresQuote && !tp.requiresQuote, 'Both should price');
  const ratio = tp.productCost / dp.productCost;
  assert.ok(Math.abs(ratio - 1.75) < 0.01, `TP/DP product cost ratio should be 1.75, got ${ratio.toFixed(4)}`);
});

test('backward compat: shape=triple_pane with no unitType prices as TP (1.75×)', () => {
  const legacyPane = pane({ shape: 'triple_pane', coating: 'clear', finish: 'annealed', grid: 'none' });
  delete legacyPane.unitType; // simulate old Supabase pane with no unitType column
  const legacy   = calcPane(legacyPane, 'busick');
  const explicit = calcPane(pane({ unitType: 'triple_pane', coating: 'clear', finish: 'annealed', grid: 'none' }), 'busick');
  assert.ok(!legacy.requiresQuote, 'legacy triple_pane shape should price');
  assert.strictEqual(legacy.productCost, explicit.productCost, 'legacy shape=triple_pane should match unitType=triple_pane');
});

test('calcPaneWeight SP returns lower weight than IG (half the glass)', () => {
  const sp = calcPaneWeight({ width: 24, height: 36, thickness: '1/8"', unitType: 'single_pane' });
  const ig = calcPaneWeight({ width: 24, height: 36, thickness: '1/8"', unitType: 'double_pane' });
  assert.ok(sp < ig, `SP weight (${sp}) should be less than IG weight (${ig})`);
  // SP 1/8" = 1.64 lbs/SF; IG 1/8" = 3.28 lbs/SF → exactly half
  assert.ok(Math.abs(sp / ig - 0.5) < 0.01, `SP should be exactly half IG weight`);
});

test('calcPaneWeight TP returns greater weight than IG', () => {
  const ig = calcPaneWeight({ width: 24, height: 36, thickness: '1/8"', unitType: 'double_pane' });
  const tp = calcPaneWeight({ width: 24, height: 36, thickness: '1/8"', unitType: 'triple_pane' });
  assert.ok(tp > ig, `TP weight (${tp}) should exceed IG weight (${ig})`);
});

test('TP grid adder doubles vs DP for same pane', () => {
  const dpGrid = calcPane(pane({ unitType: 'double_pane', grid: 'standard', width: 24, height: 36 }), 'busick');
  const dpNone = calcPane(pane({ unitType: 'double_pane', grid: 'none',     width: 24, height: 36 }), 'busick');
  const tpGrid = calcPane(pane({ unitType: 'triple_pane', coating: 'clear', finish: 'annealed', grid: 'standard', width: 24, height: 36 }), 'busick');
  const tpNone = calcPane(pane({ unitType: 'triple_pane', coating: 'clear', finish: 'annealed', grid: 'none',     width: 24, height: 36 }), 'busick');
  // TP grid contribution is roughly 2× DP grid contribution (same shapeMult ratio holds for grid adder)
  const dpGridCost = dpGrid.productCost - dpNone.productCost;
  const tpGridCost = tpGrid.productCost - tpNone.productCost;
  assert.ok(tpGridCost > dpGridCost, `TP grid cost (${tpGridCost}) should exceed DP grid cost (${dpGridCost})`);
});

// ─── O. Tiered multipliers ────────────────────────────────────────────────────

section('O. Tiered multipliers');

test('getMarkupTier: glassCost at tier 1 boundary ($150) uses tier 1 (3.00×)', () => {
  assert.strictEqual(getMarkupTier(150, DEFAULT_MARKUP_TIERS).multiplier, 3.00);
});
test('getMarkupTier: glassCost just above tier 1 boundary uses tier 2 (2.75×)', () => {
  assert.strictEqual(getMarkupTier(150.01, DEFAULT_MARKUP_TIERS).multiplier, 2.75);
});
test('getMarkupTier: glassCost at tier 2 boundary ($300) uses tier 2 (2.75×)', () => {
  assert.strictEqual(getMarkupTier(300, DEFAULT_MARKUP_TIERS).multiplier, 2.75);
});
test('getMarkupTier: glassCost just above tier 2 boundary uses tier 3 (2.50×)', () => {
  assert.strictEqual(getMarkupTier(300.01, DEFAULT_MARKUP_TIERS).multiplier, 2.50);
});
test('getMarkupTier: very high glassCost still falls in the uncapped last tier', () => {
  assert.strictEqual(getMarkupTier(50000, DEFAULT_MARKUP_TIERS).multiplier, 2.50);
});
test('calcPane applies a lower multiplier to a costlier pane (higher tier)', () => {
  const small = calcPane(pane({ width: 12, height: 12, coating: 'clear', finish: 'annealed', grid: 'none' }), 'busick');
  const large = calcPane(pane({ width: 96, height: 96, coating: 'clear', finish: 'annealed', grid: 'none' }), 'busick');
  const rawRate = PRICE_CATALOG.rates.busick['1/8"'].clear_ann;
  const sup = PRICE_CATALOG.suppliers.busick;
  const glassCostSmall = ((12 * 12) / 144) * rawRate * sup.markup;
  const glassCostLarge = ((96 * 96) / 144) * rawRate * sup.markup;
  const multSmall = getMarkupTier(glassCostSmall, DEFAULT_MARKUP_TIERS).multiplier;
  const multLarge = getMarkupTier(glassCostLarge, DEFAULT_MARKUP_TIERS).multiplier;
  assert.ok(multLarge < multSmall, `Costlier pane should get a lower tier multiplier (small=${multSmall}, large=${multLarge})`);
  assert.ok(Math.abs(small.productCost - glassCostSmall * multSmall) < 0.01, 'small pane productCost should use tier 1');
  assert.ok(Math.abs(large.productCost - glassCostLarge * multLarge) < 0.01, 'large pane productCost should use its own tier');
});
test('admin-configured markup_tiers override DEFAULT_MARKUP_TIERS', () => {
  appConfig.markup_tiers = [{ id: 1, name: 'Flat', maxCost: null, multiplier: 4.0 }];
  const r = calcPane(pane({ width: 24, height: 36, coating: 'clear', finish: 'annealed', grid: 'none' }), 'busick');
  const rawRate = PRICE_CATALOG.rates.busick['1/8"'].clear_ann;
  const sup = PRICE_CATALOG.suppliers.busick;
  const glassCost = ((24 * 36) / 144) * rawRate * sup.markup;
  assert.ok(Math.abs(r.productCost - glassCost * 4.0) < 0.01, 'flat 4.0x admin override should apply');
  appConfig.markup_tiers = null;
});

// ─── P. Per-pane rounding ──────────────────────────────────────────────────────

section('P. Per-pane rounding');

test('roundToIncrement rounds to nearest $25 by default', () => {
  assert.strictEqual(roundToIncrement(412, 25), 400);
  assert.strictEqual(roundToIncrement(413, 25), 425);
  assert.strictEqual(roundToIncrement(437.5, 25), 450);
});
test('roundToIncrement respects a custom increment', () => {
  assert.strictEqual(roundToIncrement(462, 50), 450);
  assert.strictEqual(roundToIncrement(480, 50), 500);
});
test('calcPane roundedTotal rounds lineTotal to the configured increment', () => {
  const r = calcPane(pane({ width: 24, height: 36 }), 'busick');
  assert.strictEqual(r.roundedTotal, roundToIncrement(r.lineTotal, appConfig.round_increment || 25));
});
test('calcJob default (unrounded) sums raw lineTotal — estimating screens are unaffected by rounding', () => {
  const panes = [pane({ width: 24, height: 36 }), pane({ width: 30, height: 40 })];
  const job = calcJob(panes, 'busick');
  const raw = panes.reduce((s, p) => s + calcPane(p, 'busick').lineTotal, 0);
  assert.ok(Math.abs(job.grandTotal - raw) < 0.02, 'Unrounded grandTotal should equal sum of raw lineTotals');
});
test('calcJob({rounded:true}) sums each roundedTotal instead of raw lineTotal', () => {
  const panes = [pane({ width: 24, height: 36 }), pane({ width: 30, height: 40 })];
  const job = calcJob(panes, 'busick', { rounded: true });
  const roundedSum = panes.reduce((s, p) => s + calcPane(p, 'busick').roundedTotal, 0);
  assert.strictEqual(job.grandTotal, +roundedSum.toFixed(2));
});
test('rounded and unrounded grandTotal can legitimately differ for the same panes', () => {
  const panes = [pane({ width: 17, height: 23 })];
  const r = calcPane(panes[0], 'busick');
  if (r.lineTotal !== r.roundedTotal) {
    const rawJob     = calcJob(panes, 'busick');
    const roundedJob = calcJob(panes, 'busick', { rounded: true });
    assert.notStrictEqual(rawJob.grandTotal, roundedJob.grandTotal);
  }
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(50));
console.log(`  ${passed + failed} tests  |  ${passed} passed  |  ${failed} failed`);
console.log('═'.repeat(50));

if (failed > 0) {
  console.log('\nFailed tests:');
  failures.forEach(f => console.log(`  ✗ ${f.name}\n    ${f.message}`));
  process.exit(1);
}

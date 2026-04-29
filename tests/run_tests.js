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
  version: '2026-03-01',
  laborRate: 200,
  suppliers: {
    busick:    { name: 'Busick',    markup: 1.25,  gridAdder: 5.00  },
    glaz_tech: { name: 'Glaz-Tech', markup: 1.275, gridAdder: 3.75  },
    oldcastle: { name: 'Oldcastle', markup: 1.15,  gridAdder: 2.50  },
  },
  rates: {
    busick: {
      '1/8"':  { clear_ann: 7.72,  clear_temp: 11.97, c270_ann: 12.01, c270_temp: 18.53, c360_ann: 13.90, c360_temp: 20.39 },
      '3/16"': { clear_ann: 8.66,  clear_temp: 13.00, c270_ann: 13.98, c270_temp: 19.24, c360_ann: 15.40, c360_temp: 22.40 },
      '1/4"':  { clear_ann: 8.66,  clear_temp: 13.00, c270_ann: 13.98, c270_temp: 19.24, c360_ann: null,  c360_temp: null  },
    },
    glaz_tech: {
      '1/8"':  { clear_ann: 9.95,  clear_temp: 11.04, c270_ann: 12.21, c270_temp: 13.75, c360_ann: 13.89, c360_temp: 15.50 },
      '3/16"': { clear_ann: 11.82, clear_temp: 14.22, c270_ann: 12.88, c270_temp: 16.58, c360_ann: 15.52, c360_temp: 17.67 },
      '1/4"':  { clear_ann: 11.94, clear_temp: 14.35, c270_ann: 14.13, c270_temp: 17.76, c360_ann: 15.85, c360_temp: 18.41 },
    },
    oldcastle: {
      '1/8"':  { clear_ann: 8.40,  clear_temp: 10.64, c270_ann: 11.82, c270_temp: 14.06, c360_ann: 13.27, c360_temp: 15.79 },
      '3/16"': { clear_ann: 9.80,  clear_temp: 12.04, c270_ann: 14.78, c270_temp: 17.02, c360_ann: null,  c360_temp: 17.78 },
      '1/4"':  { clear_ann: 8.04,  clear_temp:  9.50, c270_ann: 10.51, c270_temp: 12.54, c360_ann: 12.25, c360_temp: 14.25 },
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
    triple_pane:   1.75,
  },
};

const DEFAULT_MARKUP_TIERS = [
  { id: 1, name: 'Standard',  maxCost: 150,  multiplier: 3.00 },
  { id: 2, name: 'Large',     maxCost: 300,  multiplier: 2.75 },
  { id: 3, name: 'Oversized', maxCost: null, multiplier: 2.50 },
];

// Minimal appConfig mock — tests use default tiers (markup_tiers: null → fallback to DEFAULT_MARKUP_TIERS)
let appConfig = { markup_tiers: null };

function getMarkupTier(glassCost, tiers) {
  const sorted = [...tiers].sort((a, b) => {
    if (a.maxCost === null) return 1;
    if (b.maxCost === null) return -1;
    return a.maxCost - b.maxCost;
  });
  return sorted.find(t => t.maxCost === null || glassCost <= t.maxCost) || sorted[sorted.length - 1];
}

function getDefaultSupplier() {
  return localStorage.getItem('fg_default_supplier') || 'busick';
}

function fmt(n) {
  return '$' + (+n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtRange(n) {
  const band = parseFloat(localStorage.getItem('fg_range_band') || '0.08');
  const low  = Math.max(400, n * (1 - band));
  const high = n * (1 + band);
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
  const coatingKey = (pane.coating === 'c180' || pane.coating === 'hardcoat') ? 'c270' : pane.coating;
  const rateKey   = `${coatingKey}_${finishKey}`;
  const sup       = PRICE_CATALOG.suppliers[supplier] || PRICE_CATALOG.suppliers.busick;
  const rawRate   = PRICE_CATALOG.rates[supplier]?.[pane.thickness]?.[rateKey];

  if (rawRate === null || rawRate === undefined) return { requiresQuote: true };

  const gridMode       = pane.grid !== undefined ? pane.grid : (pane.gridEnabled ? 'standard' : 'none');
  const gridAdder      = gridMode !== 'none' ? sup.gridAdder : 0;
  const customGridFlat = gridMode === 'custom' ? 50 : 0;
  const shapeMult      = PRICE_CATALOG.shapeMultipliers[pane.shape] || 1.0;
  const glassCost      = SF * (rawRate + gridAdder) * shapeMult;
  const tier           = getMarkupTier(glassCost, appConfig.markup_tiers || DEFAULT_MARKUP_TIERS);
  const laborHrs       = pane.laborHrs ?? 1.0;
  const laborCost      = laborHrs * PRICE_CATALOG.laborRate;
  const productCost    = +(glassCost * tier.multiplier * qty + customGridFlat * qty).toFixed(2);
  const laborTotal     = +(laborCost * qty).toFixed(2);
  const lineTotal      = +(productCost + laborTotal).toFixed(2);

  return { sqft: +(SF * qty).toFixed(4), productCost, laborCost: laborTotal, materialsCost: 0, lineTotal, requiresQuote: false, gridMode, tierName: tier.name };
}

function calcJob(panes, supplier) {
  let totalProduct = 0, totalLabor = 0;
  panes.forEach(p => {
    const r = calcPane(p, supplier);
    if (!r || r.requiresQuote) return;
    totalProduct += r.productCost;
    totalLabor   += r.laborCost;
  });
  return {
    totalProduct:   +totalProduct.toFixed(2),
    totalLabor:     +totalLabor.toFixed(2),
    totalMaterials: 0,
    grandTotal:     +(totalProduct + totalLabor).toFixed(2),
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
  };
}

function getPaneLabel(pane) {
  const coatingMap = {
    clear:    'Clear',
    hardcoat: 'Hardcoat',
    c180:     'Single Softcoat',
    c270:     'Double Hardcoat',
    c360:     'Triple Hardcoat',
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
    qty:         1,
    widthWhole:  '24',
    widthFrac:   '',
    heightWhole: '36',
    heightFrac:  '',
    width:       24,
    height:      36,
    unit:        'in',
    laborHrs:    1.0,
    ...overrides,
  };
}

// ─── A. Terminology / Labels ─────────────────────────────────────────────────

section('A. Coating chip labels');

test('c270 renders as "Double Hardcoat"', () => {
  assert.strictEqual(getPaneLabel(pane({ coating: 'c270', finish: 'annealed' })).includes('Double Hardcoat'), true);
});
test('c360 renders as "Triple Hardcoat"', () => {
  assert.strictEqual(getPaneLabel(pane({ coating: 'c360', finish: 'annealed' })).includes('Triple Hardcoat'), true);
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
  const expectedDiff = +(SF * PRICE_CATALOG.suppliers.busick.gridAdder * 3).toFixed(2);
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
  assert.strictEqual(r.laborCost, 200.00);
});

test('calcPane uses pane.laborHrs for labor cost (1.5 hr)', () => {
  const r = calcPane(pane({ laborHrs: 1.5 }), 'busick');
  assert.strictEqual(r.laborCost, 300.00);
});

test('calcPane uses pane.laborHrs for labor cost (0.25 hr)', () => {
  const r = calcPane(pane({ laborHrs: 0.25 }), 'busick');
  assert.strictEqual(r.laborCost, 50.00);
});

test('calcPane defaults to 1.0 hr when laborHrs is missing (backward compat)', () => {
  const oldPane = pane();
  delete oldPane.laborHrs;
  const r = calcPane(oldPane, 'busick');
  assert.strictEqual(r.laborCost, 200.00);
});

test('laborHrs scales with qty', () => {
  const r = calcPane(pane({ laborHrs: 1.0, qty: 3 }), 'busick');
  assert.strictEqual(r.laborCost, 600.00);
});

test('calcPane accepts no difficulty argument (does not throw)', () => {
  assert.doesNotThrow(() => calcPane(pane(), 'busick'));
});

// ─── E. Pricing engine — coating aliasing ────────────────────────────────────

section('E. Coating rate aliasing (c180 and hardcoat → c270 rates)');

test('c180 and c270 produce identical product cost', () => {
  const c270r = calcPane(pane({ coating: 'c270' }), 'busick');
  const c180r = calcPane(pane({ coating: 'c180' }), 'busick');
  assert.strictEqual(c270r.productCost, c180r.productCost);
});

test('hardcoat and c270 produce identical product cost', () => {
  const c270r    = calcPane(pane({ coating: 'c270'     }), 'busick');
  const hardcoat = calcPane(pane({ coating: 'hardcoat' }), 'busick');
  assert.strictEqual(c270r.productCost, hardcoat.productCost);
});

test('c180 does not return requiresQuote', () => {
  const r = calcPane(pane({ coating: 'c180', thickness: '1/8"', finish: 'annealed' }), 'busick');
  assert.strictEqual(r.requiresQuote, false);
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

test('triple_pane shape multiplier is 1.75', () => {
  assert.strictEqual(PRICE_CATALOG.shapeMultipliers.triple_pane, 1.75);
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
    pane({ coating: 'c360', thickness: '1/4"', finish: 'annealed' }), // null rate → requiresQuote
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

// ─── L. Tiered markup system ─────────────────────────────────────────────────

section('L. Tiered markup system — getMarkupTier + calcPane');

test('getMarkupTier returns Tier 1 (Standard) for glassCost = $0', () => {
  const t = getMarkupTier(0, DEFAULT_MARKUP_TIERS);
  assert.strictEqual(t.name, 'Standard');
  assert.strictEqual(t.multiplier, 3.00);
});

test('getMarkupTier returns Tier 1 (Standard) for glassCost = $150 (boundary)', () => {
  const t = getMarkupTier(150, DEFAULT_MARKUP_TIERS);
  assert.strictEqual(t.name, 'Standard');
});

test('getMarkupTier returns Tier 2 (Large) for glassCost = $150.01', () => {
  const t = getMarkupTier(150.01, DEFAULT_MARKUP_TIERS);
  assert.strictEqual(t.name, 'Large');
  assert.strictEqual(t.multiplier, 2.75);
});

test('getMarkupTier returns Tier 2 (Large) for glassCost = $300 (boundary)', () => {
  const t = getMarkupTier(300, DEFAULT_MARKUP_TIERS);
  assert.strictEqual(t.name, 'Large');
});

test('getMarkupTier returns Tier 3 (Oversized) for glassCost = $300.01', () => {
  const t = getMarkupTier(300.01, DEFAULT_MARKUP_TIERS);
  assert.strictEqual(t.name, 'Oversized');
  assert.strictEqual(t.multiplier, 2.50);
});

test('getMarkupTier returns Tier 3 (Oversized) for very large glassCost', () => {
  const t = getMarkupTier(99999, DEFAULT_MARKUP_TIERS);
  assert.strictEqual(t.name, 'Oversized');
});

test('getMarkupTier works with custom tier configuration', () => {
  const custom = [
    { id: 1, name: 'Budget', maxCost: 100, multiplier: 3.50 },
    { id: 2, name: 'Premium', maxCost: null, multiplier: 2.00 },
  ];
  assert.strictEqual(getMarkupTier(50, custom).name, 'Budget');
  assert.strictEqual(getMarkupTier(100, custom).name, 'Budget');
  assert.strictEqual(getMarkupTier(101, custom).name, 'Premium');
});

test('calcPane returns tierName in result', () => {
  const r = calcPane(pane({ width: 24, height: 36 }), 'busick');
  assert.ok('tierName' in r, 'result should include tierName');
  assert.strictEqual(typeof r.tierName, 'string');
});

test('small pane uses Tier 1 multiplier (3.0×) — glassCost well below $150', () => {
  // 12×12, clear, 1/8", annealed, no grid → SF=1, glassCost = 7.72 → Tier 1
  const r = calcPane(pane({ width: 12, height: 12, grid: 'none' }), 'busick');
  const SF = (12 * 12) / 144;
  const glassCost = SF * 7.72;
  const expected = +(glassCost * 3.00).toFixed(2);
  assert.ok(Math.abs(r.productCost - expected) < 0.01,
    `Expected ${expected}, got ${r.productCost}`);
  assert.strictEqual(r.tierName, 'Standard');
});

test('large pane uses Tier 2 multiplier (2.75×) — glassCost between $150 and $300', () => {
  // 34×76, clear, 1/8", annealed, no grid
  // SF = (34*76)/144 = 17.944..., glassCost = 17.944 * 7.72 ≈ 138.5 → barely Tier 1
  // Use c360_temp to get higher raw rate: 20.39 $/SF → glassCost = 17.944 * 20.39 ≈ 365.9 → Tier 3
  // Let's find a combo that lands in Tier 2 ($150–$300):
  // 24×72 clear_ann: SF = (24*72)/144 = 12, glassCost = 12 * 7.72 = 92.64 → Tier 1
  // 34×76 c270_temp: SF=17.944, glassCost = 17.944 * 18.53 ≈ 332.4 → Tier 3
  // 24×72 c270_ann: SF=12, glassCost = 12 * 12.01 = 144.12 → Tier 1
  // 24×84 c270_ann: SF=14, glassCost = 14 * 12.01 = 168.14 → Tier 2 ✓
  appConfig.markup_tiers = null; // ensure defaults used
  const r = calcPane(pane({ width: 24, height: 84, coating: 'c270', finish: 'annealed', grid: 'none' }), 'busick');
  const SF = (24 * 84) / 144;
  const glassCost = SF * 12.01;
  assert.ok(glassCost > 150 && glassCost <= 300, `glassCost ${glassCost.toFixed(2)} should be in Tier 2 range`);
  const expected = +(glassCost * 2.75).toFixed(2);
  assert.ok(Math.abs(r.productCost - expected) < 0.01,
    `Expected ${expected} (Tier 2 × 2.75), got ${r.productCost}`);
  assert.strictEqual(r.tierName, 'Large');
});

test('oversized pane uses Tier 3 multiplier (2.5×) — glassCost above $300', () => {
  // 34×76 c270_temp: SF=17.944, rawRate=18.53, glassCost ≈ 332.4 → Tier 3
  appConfig.markup_tiers = null;
  const r = calcPane(pane({ width: 34, height: 76, coating: 'c270', finish: 'tempered', grid: 'none' }), 'busick');
  const SF = (34 * 76) / 144;
  const glassCost = SF * 18.53;
  assert.ok(glassCost > 300, `glassCost ${glassCost.toFixed(2)} should be above $300`);
  const expected = +(glassCost * 2.50).toFixed(2);
  assert.ok(Math.abs(r.productCost - expected) < 0.01,
    `Expected ${expected} (Tier 3 × 2.50), got ${r.productCost}`);
  assert.strictEqual(r.tierName, 'Oversized');
});

test('admin-configured markup_tiers override DEFAULT_MARKUP_TIERS', () => {
  const custom = [
    { id: 1, name: 'Base', maxCost: 500, multiplier: 4.00 },
    { id: 2, name: 'XL', maxCost: null, multiplier: 3.00 },
  ];
  appConfig.markup_tiers = custom;
  const r = calcPane(pane({ width: 24, height: 36, grid: 'none' }), 'busick');
  assert.strictEqual(r.tierName, 'Base');
  const SF = (24 * 36) / 144;
  const glassCost = SF * 7.72;
  const expected = +(glassCost * 4.00).toFixed(2);
  assert.ok(Math.abs(r.productCost - expected) < 0.01,
    `Expected ${expected} with custom 4.0× tier, got ${r.productCost}`);
  appConfig.markup_tiers = null; // reset
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

// Housecall Pro proxy — every call FieldPricer makes to Housecall Pro goes
// through here, so the HCP API key never reaches a browser.
//
// Admin-only actions (read-only against HCP):
//   status      → what's connected (no key, just last 4 / company / who / when)
//   connect     → { apiKey } test it against GET /company, then store it in Vault
//   test        → re-check the stored key against GET /company
//   disconnect  → delete the stored key
//   reference   → company locations, employees, job types, lead sources, tags
//
// Lookup actions (any active user — techs look customers up while quoting;
// read-only against HCP):
//   available        → { connected, mock } — whether lookup can be offered
//   searchCustomers  → { q } customers matching a name / phone / email, with addresses
//   customerWork     → { customerId } that customer's recent jobs and estimates
//
// Send (admins, or techs when Sending rules allow it):
//   send → { quoteId, payload: { optionName, note, lines[] }, customerId?, createNewCustomer? }
//   Creates (or updates) the estimate / option / job in Housecall Pro.
//   Safeguards for a REAL key: sending must be switched on in Sending rules,
//   and only customers whose name starts with "ZZ TEST" can be written to.
//   Never sends anything to the customer (no send_estimate call). Everything
//   created is tagged "fieldpricer-test". Mock keys simulate every step.
//
// Demo reset (admins, TEST VERSION ONLY — refused unless HCP_ALLOW_MOCK=true):
//   resetDemo → { quotes: [{ row, panes, manualCosts, signaturePngBase64? }] }
//   Replaces the demo quotes (ids starting q_demo_), clears the sync log,
//   resets integration settings and reconnects the mock key. Quotes it didn't
//   create are never touched.
//
// Mock mode (STAGING ONLY): when the HCP_ALLOW_MOCK secret is "true", an API
// key starting with "mock_" is answered with fixture data instead of calling
// Housecall Pro ("mock_reject" simulates a rejected key). Never set
// HCP_ALLOW_MOCK on production.
//
// Deploy: supabase functions deploy hcp-proxy --project-ref <ref>

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const HCP_BASE = 'https://api.housecallpro.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

class HcpError extends Error {
  constructor(public kind: 'auth' | 'rate_limit' | 'unreachable' | 'unexpected', message: string, public status = 0) {
    super(message);
  }
}

const allowMock = () => Deno.env.get('HCP_ALLOW_MOCK') === 'true';
const isMockKey = (key: string) => allowMock() && key.startsWith('mock_');

// ---------------------------------------------------------------------
// Housecall Pro GET
// ---------------------------------------------------------------------
async function hcpGet(path: string, key: string): Promise<any> {
  if (isMockKey(key)) return mockGet(path, key);
  let res: Response;
  try {
    res = await fetch(HCP_BASE + path, {
      headers: { Authorization: `Token ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
  } catch (_e) {
    throw new HcpError('unreachable', "Couldn't reach Housecall Pro. Check your connection and try again.");
  }
  if (res.status === 401 || res.status === 403) {
    throw new HcpError('auth', 'Housecall Pro rejected this API key. Check you copied the whole key, that it hasn\'t been deleted in Housecall Pro, and that the account is on the MAX plan.', res.status);
  }
  if (res.status === 429) {
    throw new HcpError('rate_limit', 'Housecall Pro is limiting requests right now. Wait a minute and try again.', 429);
  }
  if (!res.ok) {
    throw new HcpError('unexpected', `Housecall Pro returned an error (${res.status}). Try again in a few minutes.`, res.status);
  }
  return await res.json();
}

async function hcpWrite(method: 'POST' | 'PUT', path: string, key: string, body: unknown, form = false): Promise<any> {
  let res: Response;
  try {
    res = await fetch(HCP_BASE + path, {
      method,
      headers: form
        ? { Authorization: `Token ${key}`, Accept: 'application/json' }
        : { Authorization: `Token ${key}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: form ? (body as FormData) : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch (_e) {
    throw new HcpError('unreachable', "Couldn't reach Housecall Pro. Nothing was changed there; try again.");
  }
  if (res.status === 401 || res.status === 403) throw new HcpError('auth', 'Housecall Pro rejected the API key. Replace it in Admin > Integrations.', res.status);
  if (res.status === 429) throw new HcpError('rate_limit', 'Housecall Pro is limiting requests right now. Wait a minute and retry.', 429);
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j?.error || j?.message || (j?.errors ? JSON.stringify(j.errors) : ''); } catch (_) { /* ignore */ }
    throw new HcpError('unexpected', `Housecall Pro refused ${method} ${path.split('?')[0]} (${res.status})${detail ? ': ' + String(detail).slice(0, 300) : ''}`, res.status);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

// ---------------------------------------------------------------------
// Fixtures for mock mode — shapes follow HCP's published schemas
// ---------------------------------------------------------------------
function mockGet(path: string, key: string): any {
  if (key === 'mock_reject') throw new HcpError('auth', 'Housecall Pro rejected this API key. (Mock mode: "mock_reject" always fails.)', 401);
  const p = path.split('?')[0];
  if (p === '/company') return {
    id: 'mock-company', name: 'FastGlass (mock data)', time_zone: 'America/Denver',
    locations: [],
  };
  if (p === '/employees') return { page: 1, total_pages: 1, total_items: 3, employees: [
    { id: 'pro_mock_cj', first_name: 'CJ', last_name: '', email: 'cj@example.com', role: 'admin' },
    { id: 'pro_mock_anthony', first_name: 'Anthony', last_name: '', email: 'anthony@example.com', role: 'field tech' },
    { id: 'pro_mock_office', first_name: 'Office', last_name: '', email: 'office@example.com', role: 'office staff' },
  ] };
  if (p === '/job_fields/job_types') return { page: 1, total_pages: 1, total_items: 3, job_types: [
    { id: 'jbt_mock_1', name: 'Glass Replacement' }, { id: 'jbt_mock_2', name: 'Window Repair' }, { id: 'jbt_mock_3', name: 'Estimate Visit' },
  ] };
  if (p === '/lead_sources') return { page: 1, total_pages: 1, total_items: 3, lead_sources: [
    { id: 'ls_mock_1', name: 'Google', editable: true }, { id: 'ls_mock_2', name: 'Referral', editable: true }, { id: 'ls_mock_3', name: 'Repeat customer', editable: true },
  ] };
  if (p === '/customers') {
    const q = decodeURIComponent((path.split('q=')[1] || '').split('&')[0]).toLowerCase().replace(/\D/g, (c) => c);
    const digits = q.replace(/\D/g, '');
    const all = MOCK_CUSTOMERS.filter(c => {
      const hay = [c.first_name, c.last_name, c.company, c.email].join(' ').toLowerCase();
      const phones = [c.mobile_number, c.home_number].join(' ').replace(/\D/g, '');
      return (q.trim().length >= 2 && hay.includes(q.trim())) || (digits.length >= 3 && phones.includes(digits));
    });
    return { page: 1, total_pages: 1, total_items: all.length, customers: all };
  }
  if (p === '/jobs' || p === '/estimates') {
    const cid = decodeURIComponent((path.split('customer_id=')[1] || '').split('&')[0]);
    const rows = (p === '/jobs' ? MOCK_JOBS : MOCK_ESTIMATES).filter(r => r.customer.id === cid);
    return p === '/jobs' ? { jobs: rows } : { estimates: rows };
  }
  if (p === '/tags') return { page: 1, total_pages: 1, total_items: 2, tags: [{ id: 'tag_mock_1', name: 'Residential' }, { id: 'tag_mock_2', name: 'Commercial' }] };
  throw new HcpError('unexpected', `Mock mode has no fixture for ${p}`);
}

const MOCK_CUSTOMERS = [
  { id: 'cus_mock_dana', first_name: 'Dana', last_name: 'Whitfield', company: '', email: 'dana.w@example.com', mobile_number: '3035550148', home_number: '',
    addresses: [
      { id: 'adr_mock_1', type: 'service', street: '1820 Pearl St', street_line_2: '', city: 'Boulder', state: 'CO', zip: '80302', country: 'US' },
      { id: 'adr_mock_2', type: 'service', street: '455 Arapahoe Ave', street_line_2: 'Unit 3', city: 'Boulder', state: 'CO', zip: '80302', country: 'US' },
    ] },
  { id: 'cus_mock_danam', first_name: 'Dana', last_name: 'Whitfield-Moore', company: '', email: 'dwmoore@example.com', mobile_number: '3035550199', home_number: '',
    addresses: [{ id: 'adr_mock_3', type: 'service', street: '77 Spruce Ln', street_line_2: '', city: 'Louisville', state: 'CO', zip: '80027', country: 'US' }] },
  { id: 'cus_mock_pond', first_name: '', last_name: '', company: 'Ponderosa Property Mgmt', email: 'maint@example.com', mobile_number: '7205550102', home_number: '',
    addresses: [
      { id: 'adr_mock_4', type: 'service', street: '2400 Baseline Rd', street_line_2: 'Bldg A', city: 'Boulder', state: 'CO', zip: '80305', country: 'US' },
      { id: 'adr_mock_5', type: 'service', street: '2410 Baseline Rd', street_line_2: 'Bldg B', city: 'Boulder', state: 'CO', zip: '80305', country: 'US' },
    ] },
  { id: 'cus_mock_ray', first_name: 'Ray', last_name: 'Okafor', company: '', email: 'ray.okafor@example.com', mobile_number: '3035550177', home_number: '',
    addresses: [{ id: 'adr_mock_6', type: 'service', street: '918 Mapleton Ave', street_line_2: '', city: 'Boulder', state: 'CO', zip: '80304', country: 'US' }] },
];
const MOCK_JOBS = [
  { id: 'job_mock_2231', invoice_number: '2231', description: 'Window glass replacement', work_status: 'complete', customer: { id: 'cus_mock_dana' }, address: { id: 'adr_mock_1' }, schedule: { scheduled_start: '2026-10-03T15:00:00Z' }, created_at: '2026-09-28T15:00:00Z' },
  { id: 'job_mock_2240', invoice_number: '2240', description: 'Storefront glass', work_status: 'scheduled', customer: { id: 'cus_mock_pond' }, address: { id: 'adr_mock_4' }, schedule: { scheduled_start: '2026-11-11T16:00:00Z' }, created_at: '2026-11-02T15:00:00Z' },
];
const MOCK_ESTIMATES = [
  { id: 'est_mock_1038', estimate_number: '1038', work_status: 'needs scheduling', customer: { id: 'cus_mock_dana' }, address: { id: 'adr_mock_1' }, schedule: {}, created_at: '2026-09-12T15:00:00Z', options: [{ name: 'Option #1' }] },
];

// Trim HCP records down to what the lookup screens show.
const custName = (c: any) => [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company || c.email || 'Unnamed customer';
const fmtPhone = (n?: string) => {
  const d = String(n || '').replace(/\D/g, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (n || '');
};
function trimCustomer(c: any) {
  return {
    id: c.id,
    name: custName(c),
    company: c.company || '',
    firstName: c.first_name || '',
    lastName: c.last_name || '',
    phone: fmtPhone(c.mobile_number || c.home_number || c.work_number),
    email: c.email || '',
    addresses: (c.addresses || []).map((a: any) => ({
      id: a.id, street: a.street || '', street2: a.street_line_2 || '', city: a.city || '', state: a.state || '', zip: a.zip || '',
    })),
  };
}
function trimWork(kind: 'Job' | 'Estimate', w: any) {
  return {
    kind,
    id: w.id,
    number: String((kind === 'Job' ? w.invoice_number : w.estimate_number) ?? ''),
    status: w.work_status || '',
    date: w.schedule?.scheduled_start || w.created_at || null,
    addressId: w.address?.id || null,
    description: w.description || '',
  };
}

// ---------------------------------------------------------------------
// Send to HCP
// ---------------------------------------------------------------------
const TEST_PREFIX = 'zz test';
const DEFAULT_SETTINGS = {
  destination: 'estimate', approveOnSign: true,
  mapping: { leadSource: '', tags: 'FieldPricer', jobTypeId: '', nameAs: 'person' },
  team: {} as Record<string, string>,
  rules: { sendingEnabled: false, whoCanSend: 'admins', resend: 'update' },
};
function mergeSettings(s: any) {
  s = s || {};
  return { ...DEFAULT_SETTINGS, ...s, mapping: { ...DEFAULT_SETTINGS.mapping, ...(s.mapping || {}) },
    team: { ...(s.team || {}) }, rules: { ...DEFAULT_SETTINGS.rules, ...(s.rules || {}) } };
}
const nLines = (n: number) => `${n} line item${n === 1 ? '' : 's'}`;
const money = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const digitsOf = (v?: string) => String(v || '').replace(/\D/g, '');
class SendError extends Error {}

function splitName(name: string, nameAs: string) {
  const n = String(name || '').trim();
  if (nameAs === 'company') return { company: n };
  const parts = n.split(/\s+/);
  return parts.length > 1 ? { first_name: parts[0], last_name: parts.slice(1).join(' ') } : { first_name: n };
}

async function doSend(ctx: any) {
  const { key, mock, st, q, p, mode, prior, admin, chooseCustomerId, createNewCustomer } = ctx;
  const steps: string[] = [];
  const cd = q.customer_details || {};
  const link = q.hcp_link || {};
  const tags = Array.from(new Set([...String(st.mapping.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean), 'fieldpricer-test']));
  const lineItems = p.lines.map((l: any) => {
    const li: any = { name: l.name, description: l.description || '', unit_price: l.cents, quantity: l.quantity || 1 };
    if (Number.isInteger(l.costCents)) li.unit_cost = l.costCents;
    return li;
  });
  const totalCents = p.lines.reduce((s: number, l: any) => s + l.cents * (l.quantity || 1), 0);
  const employeeId = st.team[q.tech_id] || '';
  const guard = (name: string) => {
    if (!mock && !String(name || '').trim().toLowerCase().startsWith(TEST_PREFIX)) {
      throw new SendError(`While testing, FieldPricer only writes to Housecall Pro customers whose name starts with "ZZ TEST". This quote's customer is "${name}". Nothing was sent.`);
    }
  };

  // ---------- Update in place (re-send) ----------
  if (mode === 'update') {
    if (mock) {
      steps.push(`Replaced the line items on ${prior.label} (${nLines(lineItems.length)}, ${money(totalCents)}).`);
      return { steps, sync: { ...prior, sentAt: new Date().toISOString(), updatedAt: new Date().toISOString() } };
    }
    guard(prior.customerName);
    const est = await hcpGet(`/estimates/${encodeURIComponent(prior.estimateId)}`, key);
    const opt = (est?.options || []).find((o: any) => o.id === prior.optionId);
    if (opt && /approved/i.test(String(opt.approval_status || '')) ) {
      throw new SendError(`${prior.label} is already approved in Housecall Pro, so FieldPricer won't change it. Make any changes in HCP.`);
    }
    const existing = await hcpGet(`/estimates/${encodeURIComponent(prior.estimateId)}/options/${encodeURIComponent(prior.optionId)}/line_items`, key).catch(() => null);
    const ids = (existing?.line_items || existing?.data || []).map((x: any) => x.id);
    await hcpWrite('PUT', `/estimates/${encodeURIComponent(prior.estimateId)}/options/${encodeURIComponent(prior.optionId)}/line_items/bulk_update`, key,
      { line_items: lineItems.map((li: any, i: number) => (ids[i] ? { id: ids[i], ...li } : li)) });
    steps.push(`Replaced the line items on ${prior.label} (${nLines(lineItems.length)}, ${money(totalCents)}).`);
    return { steps, sync: { ...prior, sentAt: new Date().toISOString(), updatedAt: new Date().toISOString() } };
  }

  // ---------- Customer ----------
  let customer: any = null; // { id, name }
  if (chooseCustomerId || link.customerId) {
    const id = chooseCustomerId || link.customerId;
    if (mock) {
      const c = MOCK_CUSTOMERS.find(x => x.id === id);
      if (!c) throw new SendError('The linked Housecall Pro customer no longer exists. Link the quote again.');
      customer = { id: c.id, name: custName(c), addresses: c.addresses };
    } else {
      const c = await hcpGet(`/customers/${encodeURIComponent(id)}`, key);
      customer = { id: c.id, name: custName(c), addresses: c.addresses || [] };
    }
    steps.push(chooseCustomerId ? `Used the Housecall Pro customer you picked: ${customer.name}.` : `Used the linked Housecall Pro customer: ${customer.name}.`);
  } else if (!createNewCustomer) {
    const phone = digitsOf(cd.phone), email = String(cd.email || '').trim();
    let matches: any[] = [];
    for (const probe of [phone.length >= 7 ? phone : '', email].filter(Boolean)) {
      const r = mock ? { customers: MOCK_CUSTOMERS.filter(c => (digitsOf(c.mobile_number) && digitsOf(c.mobile_number).endsWith(probe.slice(-7))) || c.email.toLowerCase() === probe.toLowerCase()) }
                     : await hcpGet(`/customers?q=${encodeURIComponent(probe)}&page_size=5`, key);
      matches = (r?.customers || []).filter((c: any) => probe.includes('@') ? String(c.email || '').toLowerCase() === probe.toLowerCase()
        : [c.mobile_number, c.home_number, c.work_number].some((n: string) => digitsOf(n) && digitsOf(n).slice(-7) === probe.slice(-7)));
      if (matches.length) { steps.push(`Matched by ${probe.includes('@') ? 'email' : 'phone'}.`); break; }
    }
    if (matches.length > 1) {
      return { needsChoice: matches.slice(0, 5).map(trimCustomer) };
    }
    if (matches.length === 1) {
      const c = matches[0];
      customer = { id: c.id, name: custName(c), addresses: c.addresses || [] };
      steps.push(`Found existing Housecall Pro customer ${customer.name}.`);
    }
  }
  if (!customer) {
    guard(q.customer_name);
    const body: any = { ...splitName(q.customer_name, st.mapping.nameAs), notifications_enabled: false, tags: ['fieldpricer-test'] };
    if (cd.email) body.email = cd.email;
    if (digitsOf(cd.phone)) body.mobile_number = digitsOf(cd.phone);
    if (st.mapping.leadSource) body.lead_source = st.mapping.leadSource;
    if (mock) customer = { id: 'cus_mock_new_' + crypto.randomUUID().slice(0, 8), name: q.customer_name, addresses: [] };
    else { const c = await hcpWrite('POST', '/customers', key, body); customer = { id: c.id, name: custName(c), addresses: [] }; }
    steps.push(`Created a new Housecall Pro customer: ${customer.name} (notifications off).`);
  }
  guard(customer.name);

  // ---------- Address ----------
  let addressId: string | null = null;
  const linkedAddr = link.customerId === customer.id ? link.addressId : null;
  if (linkedAddr) {
    addressId = linkedAddr;
    steps.push('Used the address picked during lookup.');
  } else if (cd.street && cd.city && cd.state && cd.zip) {
    const same = (customer.addresses || []).find((a: any) => String(a.street || '').trim().toLowerCase() === String(cd.street).trim().toLowerCase() && digitsOf(a.zip) === digitsOf(cd.zip));
    if (same) { addressId = same.id; steps.push(`Used their existing address ${cd.street}.`); }
    else {
      if (mock) addressId = 'adr_mock_new_' + crypto.randomUUID().slice(0, 8);
      else { const a = await hcpWrite('POST', `/customers/${encodeURIComponent(customer.id)}/addresses`, key, { street: cd.street, city: cd.city, state: cd.state, zip: cd.zip, country: 'US' }); addressId = a.id; }
      steps.push(`Added the address ${cd.street}, ${cd.city} to the customer.`);
    }
  } else {
    steps.push('No full service address on the quote, so none was attached.');
  }

  // ---------- Destination ----------
  let dest = st.destination;
  if (dest === 'option' && !(link.workKind === 'Estimate' && link.workId)) { dest = 'estimate'; steps.push('No existing estimate was picked during lookup, so a new estimate was created instead of an option.'); }
  if (dest === 'job' && !addressId) throw new SendError('Housecall Pro needs a service address to create a job. Add the full address (street, city, state, ZIP) to the quote and retry.');

  const mockNum = String(1040 + Math.floor(Math.random() * 900));
  let sync: any;
  if (dest === 'job') {
    const body: any = { customer_id: customer.id, address_id: addressId, line_items: lineItems, tags, notes: p.note || '' };
    if (st.mapping.leadSource) body.lead_source = st.mapping.leadSource;
    if (employeeId) body.assigned_employee_ids = [employeeId];
    if (st.mapping.jobTypeId) body.job_fields = { job_type_id: st.mapping.jobTypeId };
    const j = mock ? { id: 'job_mock_' + mockNum, invoice_number: mockNum } : await hcpWrite('POST', '/jobs', key, body);
    sync = { kind: 'job', jobId: j.id, number: String(j.invoice_number ?? ''), label: `Job #${j.invoice_number ?? ''}` };
    steps.push(`Created ${sync.label} with ${nLines(lineItems.length)} (${money(totalCents)}).`);
  } else if (dest === 'option') {
    const body = { name: p.optionName, line_items: lineItems };
    const o = mock ? { id: 'opt_mock_' + mockNum } : await hcpWrite('POST', `/estimates/${encodeURIComponent(link.workId)}/options`, key, body);
    sync = { kind: 'option', estimateId: link.workId, optionId: o.id, number: String(link.workNumber || ''), label: `Estimate #${link.workNumber} (new option)` };
    steps.push(`Added "${p.optionName}" as a new option on Estimate #${link.workNumber} with ${nLines(lineItems.length)} (${money(totalCents)}).`);
  } else {
    const body: any = { customer_id: customer.id, note: p.note || '', options: [{ name: p.optionName, tags, line_items: lineItems }] };
    if (addressId) body.address_id = addressId;
    if (st.mapping.leadSource) body.lead_source = st.mapping.leadSource;
    if (employeeId) body.assigned_employee_ids = [employeeId];
    if (st.mapping.jobTypeId) body.estimate_fields = { job_type_id: st.mapping.jobTypeId };
    const e = mock ? { id: 'est_mock_' + mockNum, estimate_number: mockNum, options: [{ id: 'opt_mock_' + mockNum }] } : await hcpWrite('POST', '/estimates', key, body);
    sync = { kind: 'estimate', estimateId: e.id, optionId: e.options?.[0]?.id || null, number: String(e.estimate_number ?? ''), label: `Estimate #${e.estimate_number ?? ''}` };
    steps.push(`Created ${sync.label} with ${nLines(lineItems.length)} (${money(totalCents)}), before tax.`);
  }
  if (employeeId) steps.push('Assigned to the quoting tech\'s Housecall Pro employee.');

  // ---------- Approve + signature ----------
  sync.approved = false;
  if (q.status === 'approved' && st.approveOnSign && sync.kind !== 'job' && sync.optionId) {
    if (!mock) await hcpWrite('POST', '/estimates/options/approve', key, { option_ids: [sync.optionId] });
    sync.approved = true;
    steps.push('Marked the option approved in Housecall Pro (the customer signed in FieldPricer).');
    if (q.signature_url) {
      if (!mock) {
        const { data: blob } = await admin.storage.from('signatures').download(q.signature_url);
        if (blob) {
          const fd = new FormData();
          fd.append('file', new File([blob], 'customer-signature.png', { type: 'image/png' }));
          await hcpWrite('POST', `/estimates/${encodeURIComponent(sync.estimateId)}/options/${encodeURIComponent(sync.optionId)}/attachments`, key, fd, true);
        }
      }
      steps.push('Attached the customer\'s signature.');
    }
  }
  steps.push('Nothing was sent to the customer.');
  Object.assign(sync, { customerId: customer.id, customerName: customer.name, mock, sentAt: new Date().toISOString() });
  return { steps, sync };
}

// ---------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseCaller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });

    const { data: { user }, error: userErr } = await supabaseCaller.auth.getUser();
    if (userErr || !user) return json({ error: 'Your session has expired. Sign in again.' }, 401);

    const { data: me } = await supabaseCaller.from('profiles').select('role, is_active').eq('id', user.id).single();
    if (!me || me.is_active === false) return json({ error: 'This account is deactivated.' }, 403);

    const body = await req.json().catch(() => ({}));
    const LOOKUP_ACTIONS = ['available', 'searchCustomers', 'customerWork', 'send'];
    if (!LOOKUP_ACTIONS.includes(body.action) && me.role !== 'admin') {
      return json({ error: 'Only admins can manage the Housecall Pro connection.' }, 403);
    }

    // Service role: reads/writes the Vault key and hcp_connection.
    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const getKey = async (): Promise<string | null> => {
      const { data, error } = await admin.rpc('hcp_get_api_key');
      if (error) throw new Error('Could not read the stored key: ' + error.message);
      return data || null;
    };

    const readStatus = async () => {
      const { data: row } = await admin.from('hcp_connection').select('*').eq('id', 1).maybeSingle();
      const key = await getKey();
      if (!row || !key) return { connected: false };
      let connectedByName: string | null = null;
      if (row.connected_by) {
        const { data: p } = await admin.from('profiles').select('name').eq('id', row.connected_by).maybeSingle();
        connectedByName = p?.name || null;
      }
      return {
        connected: true,
        mock: isMockKey(key),
        keyLast4: row.key_last4,
        companyName: row.company_name,
        locationCount: row.location_count,
        connectedByName,
        connectedAt: row.connected_at,
        lastTestedAt: row.last_tested_at,
        lastTestOk: row.last_test_ok,
        lastError: row.last_error,
      };
    };

    switch (body.action) {
      case 'status':
        return json(await readStatus());

      case 'connect': {
        const apiKey = String(body.apiKey || '').trim();
        if (apiKey.length < 8) return json({ error: 'That doesn\'t look like a full API key. Copy the whole key from Housecall Pro and paste it again.' }, 400);
        let company: any;
        try {
          company = await hcpGet('/company', apiKey);
        } catch (e) {
          if (e instanceof HcpError) return json({ error: e.message, kind: e.kind }, 400);
          throw e;
        }
        const { error: setErr } = await admin.rpc('hcp_set_api_key', { p_key: apiKey });
        if (setErr) return json({ error: 'Could not store the key: ' + setErr.message }, 500);
        const now = new Date().toISOString();
        const { error: upErr } = await admin.from('hcp_connection').upsert({
          id: 1,
          key_last4: apiKey.slice(-4),
          company_id: company?.id ?? null,
          company_name: company?.name ?? null,
          location_count: Array.isArray(company?.locations) ? company.locations.length : 0,
          connected_by: user.id,
          connected_at: now,
          last_tested_at: now,
          last_test_ok: true,
          last_error: null,
        });
        if (upErr) return json({ error: 'Could not save the connection: ' + upErr.message }, 500);
        // A real key always starts read-only: sending stays off until an admin
        // turns it on in Sending rules. (Mock keys only ever simulate sends.)
        if (!isMockKey(apiKey)) {
          const { data: cur } = await admin.from('hcp_settings').select('settings').eq('id', 1).maybeSingle();
          const settings = cur?.settings || {};
          settings.rules = { ...(settings.rules || {}), sendingEnabled: false };
          await admin.from('hcp_settings').upsert({ id: 1, settings, updated_by: user.id, updated_at: now });
        }
        return json(await readStatus());
      }

      case 'test': {
        const key = await getKey();
        if (!key) return json({ error: 'Housecall Pro isn\'t connected.' }, 400);
        const now = new Date().toISOString();
        try {
          const company = await hcpGet('/company', key);
          await admin.from('hcp_connection').update({
            last_tested_at: now, last_test_ok: true, last_error: null,
            company_name: company?.name ?? null,
            location_count: Array.isArray(company?.locations) ? company.locations.length : 0,
          }).eq('id', 1);
        } catch (e) {
          if (!(e instanceof HcpError)) throw e;
          await admin.from('hcp_connection').update({ last_tested_at: now, last_test_ok: false, last_error: e.message }).eq('id', 1);
        }
        return json(await readStatus());
      }

      case 'disconnect': {
        const { error: clrErr } = await admin.rpc('hcp_clear_api_key');
        if (clrErr) return json({ error: 'Could not remove the key: ' + clrErr.message }, 500);
        await admin.from('hcp_connection').delete().eq('id', 1);
        return json({ connected: false });
      }

      case 'reference': {
        const key = await getKey();
        if (!key) return json({ error: 'Housecall Pro isn\'t connected.' }, 400);
        const [company, employees, jobTypes, leadSources, tags] = await Promise.allSettled([
          hcpGet('/company', key),
          hcpGet('/employees?page_size=100', key),
          hcpGet('/job_fields/job_types', key),
          hcpGet('/lead_sources?page_size=100', key),
          hcpGet('/tags?page_size=100', key),
        ]);
        const pick = <T>(r: PromiseSettledResult<any>, f: (v: any) => T) =>
          r.status === 'fulfilled' ? { ok: true, items: f(r.value) } : { ok: false, error: (r.reason as Error)?.message || 'Failed' };
        return json({
          locations: pick(company, c => (c?.locations || []).map((l: any) => ({ id: l.id, name: l.name }))),
          employees: pick(employees, v => (v?.employees || []).map((e: any) => ({
            id: e.id, name: [e.first_name, e.last_name].filter(Boolean).join(' ') || e.email || 'Unnamed', email: e.email || null, role: e.role || null,
          }))),
          jobTypes: pick(jobTypes, v => (v?.job_types || []).map((t: any) => ({ id: t.id, name: t.name }))),
          leadSources: pick(leadSources, v => (v?.lead_sources || []).map((s: any) => ({ id: s.id, name: s.name }))),
          tags: pick(tags, v => (v?.tags || []).map((t: any) => ({ id: t.id, name: t.name }))),
          mock: isMockKey(key),
        });
      }

      case 'available': {
        const key = await getKey();
        return json({ connected: !!key, mock: !!key && isMockKey(key) });
      }

      case 'searchCustomers': {
        const key = await getKey();
        if (!key) return json({ error: 'Housecall Pro isn\'t connected.' }, 400);
        const q = String(body.q || '').trim().slice(0, 100);
        if (q.length < 2) return json({ customers: [] });
        try {
          const r = await hcpGet(`/customers?q=${encodeURIComponent(q)}&page_size=8`, key);
          const customers = (r?.customers || []).map(trimCustomer);
          // Addresses normally come with the customer; fetch them if this account's response omits them.
          for (const c of customers) {
            if (!c.addresses.length) {
              try {
                const a = await hcpGet(`/customers/${encodeURIComponent(c.id)}/addresses?page_size=20`, key);
                c.addresses = trimCustomer({ addresses: a?.addresses || a?.data || [] }).addresses;
              } catch (_) { /* leave empty */ }
            }
          }
          return json({ customers });
        } catch (e) {
          if (e instanceof HcpError) return json({ error: e.message, kind: e.kind }, 502);
          throw e;
        }
      }

      case 'customerWork': {
        const key = await getKey();
        if (!key) return json({ error: 'Housecall Pro isn\'t connected.' }, 400);
        const cid = String(body.customerId || '');
        if (!cid) return json({ error: 'Missing customer.' }, 400);
        const qs = `customer_id=${encodeURIComponent(cid)}&page_size=5&sort_direction=desc`;
        const [jobs, ests] = await Promise.allSettled([
          hcpGet(`/jobs?${qs}&sort_by=created_at`, key),
          hcpGet(`/estimates?${qs}&sort_by=created_at`, key),
        ]);
        const work = [
          ...(ests.status === 'fulfilled' ? (ests.value?.estimates || []).map((w: any) => trimWork('Estimate', w)) : []),
          ...(jobs.status === 'fulfilled' ? (jobs.value?.jobs || []).map((w: any) => trimWork('Job', w)) : []),
        ];
        const failed = [jobs, ests].filter(r => r.status === 'rejected');
        return json({ work, partial: failed.length > 0, error: failed.length === 2 ? (failed[0] as PromiseRejectedResult).reason?.message : null });
      }

      case 'send': {
        const key = await getKey();
        if (!key) return json({ error: 'Housecall Pro isn\'t connected.' }, 400);
        const mock = isMockKey(key);
        const { data: setRow } = await admin.from('hcp_settings').select('settings').eq('id', 1).maybeSingle();
        const st = mergeSettings(setRow?.settings);
        if (st.rules.whoCanSend !== 'all' && me.role !== 'admin') return json({ error: 'Only admins can send quotes to Housecall Pro. An admin can change this in Sending rules.' }, 403);
        if (!mock && !st.rules.sendingEnabled) return json({ error: 'Sending to Housecall Pro is switched off. An admin can turn it on in Admin > Integrations > Sending rules.' }, 403);

        const { data: q } = await admin.from('quotes')
          .select('id, tech_id, customer_name, status, agreed_price, job_num, customer_details, hcp_link, hcp_sync, signature_url')
          .eq('id', String(body.quoteId || '')).maybeSingle();
        if (!q) return json({ error: 'That quote isn\'t saved yet. Wait a moment and try again.' }, 404);
        if (me.role !== 'admin' && q.tech_id !== user.id) return json({ error: 'You can only send your own quotes.' }, 403);
        if (q.status === 'draft') return json({ error: 'Drafts can\'t be sent. Finish the quote first.' }, 400);
        if (q.agreed_price === null || q.agreed_price === undefined) return json({ error: 'Pick the price you\'re quoting (Show Customer) before sending.' }, 400);

        const p = body.payload || {};
        const lines = Array.isArray(p.lines) ? p.lines : [];
        if (!String(p.optionName || '').trim()) return json({ error: 'Option name is empty. Set it in Field mapping.' }, 400);
        if (!lines.length || lines.length > 100 || lines.some((l: any) => !String(l?.name || '').trim() || !Number.isInteger(l.cents) || l.cents < 0)) {
          return json({ error: 'The line items aren\'t valid. Reopen the quote and try again.' }, 400);
        }
        const total = lines.reduce((s: number, l: any) => s + l.cents * (l.quantity || 1), 0);
        const quoted = Math.round(Number(q.agreed_price) * 100);
        if (total !== quoted) return json({ error: `The line items add up to ${money(total)} but the quote is ${money(quoted)}. Reopen the quote and try again.` }, 400);

        const prior = q.hcp_sync && (q.hcp_sync.estimateId || q.hcp_sync.jobId) ? q.hcp_sync : null;
        let mode = 'create';
        if (prior) {
          if (st.rules.resend === 'block') return json({ error: `This quote was already sent as ${prior.label}. Your Sending rules say changes have to be made in Housecall Pro.` }, 409);
          if (st.rules.resend === 'update' && prior.kind !== 'job' && prior.optionId && !!prior.mock === mock) mode = 'update';
        }
        const { data: meName } = await admin.from('profiles').select('name').eq('id', user.id).maybeSingle();
        const logBase = {
          quote_id: q.id, quote_label: q.job_num ? `#${q.job_num}` : null, customer_name: q.customer_name, action: mode, mock,
          line_count: lines.length, total_cents: total, settings_snapshot: st, sent_by: user.id, sent_by_name: meName?.name || null,
        };
        try {
          const r: any = await doSend({ key, mock, st, q, p: { ...p, lines }, mode, prior, admin, chooseCustomerId: body.customerId || null, createNewCustomer: !!body.createNewCustomer });
          if (r.needsChoice) return json({ needsChoice: r.needsChoice });
          await admin.from('quotes').update({ hcp_sync: r.sync }).eq('id', q.id);
          await admin.from('hcp_sync_log').insert({ ...logBase, result: mode === 'update' ? 'updated' : 'sent', hcp_ref: r.sync.label, hcp_ids: r.sync, steps: r.steps, customer_name: r.sync.customerName || q.customer_name });
          return json({ ok: true, mode, sync: r.sync, steps: r.steps });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await admin.from('hcp_sync_log').insert({ ...logBase, result: 'failed', error: msg });
          return json({ error: msg, kind: e instanceof HcpError ? e.kind : (e instanceof SendError ? 'blocked' : 'unexpected') }, e instanceof SendError ? 400 : 502);
        }
      }

      case 'resetDemo': {
        if (!allowMock()) return json({ error: 'Demo reset is only available on the test version.' }, 403);
        const quotes = Array.isArray(body.quotes) ? body.quotes : [];
        if (!quotes.length || quotes.length > 12 || quotes.some((q: any) => !String(q?.row?.id || '').startsWith('q_demo_'))) {
          return json({ error: 'Invalid demo data.' }, 400);
        }
        // Earlier hand-made test quotes from the build (replaced by the demo set).
        const LEGACY = ['q_mwvsq7cksbjr', 'q_mwvt8g7c4fg9', 'q_mwvt8mryujvh'];
        const { data: old } = await admin.from('quotes').select('id').or(`id.like.q_demo_%,id.in.(${LEGACY.join(',')})`);
        const oldIds = (old || []).map((r: any) => r.id);
        if (oldIds.length) {
          await admin.from('panes').delete().in('quote_id', oldIds);
          await admin.from('manual_costs').delete().in('quote_id', oldIds);
          await admin.from('quotes').delete().in('id', oldIds);
          await admin.storage.from('signatures').remove(oldIds.map((id: string) => `${id}.png`));
        }
        for (const q of quotes) {
          if (q.signaturePngBase64) {
            const bytes = Uint8Array.from(atob(q.signaturePngBase64), c => c.charCodeAt(0));
            const path = `${q.row.id}.png`;
            const { error: upErr } = await admin.storage.from('signatures').upload(path, bytes, { upsert: true, contentType: 'image/png' });
            if (upErr) return json({ error: 'Signature upload failed: ' + upErr.message }, 500);
            q.row.signature_url = path;
          }
          const { error: qErr } = await admin.from('quotes').insert(q.row);
          if (qErr) return json({ error: `Couldn't create ${q.row.customer_name}: ${qErr.message}` }, 500);
          if (q.panes?.length) { const { error } = await admin.from('panes').insert(q.panes); if (error) return json({ error: 'Items: ' + error.message }, 500); }
          if (q.manualCosts?.length) { const { error } = await admin.from('manual_costs').insert(q.manualCosts); if (error) return json({ error: 'Manual costs: ' + error.message }, 500); }
        }
        await admin.from('hcp_sync_log').delete().gte('id', 0);
        await admin.from('hcp_settings').upsert({ id: 1, settings: {}, updated_by: user.id, updated_at: new Date().toISOString() });
        await admin.rpc('hcp_set_api_key', { p_key: 'mock_demo' });
        const now = new Date().toISOString();
        await admin.from('hcp_connection').upsert({ id: 1, key_last4: 'demo', company_id: 'mock-company', company_name: 'FastGlass (mock data)', location_count: 0,
          connected_by: user.id, connected_at: now, last_tested_at: now, last_test_ok: true, last_error: null });
        return json({ ok: true, replaced: oldIds.length, created: quotes.length });
      }

      default:
        return json({ error: `Unknown action: ${body.action}` }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

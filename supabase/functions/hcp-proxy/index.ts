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
    const LOOKUP_ACTIONS = ['available', 'searchCustomers', 'customerWork'];
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

      default:
        return json({ error: `Unknown action: ${body.action}` }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

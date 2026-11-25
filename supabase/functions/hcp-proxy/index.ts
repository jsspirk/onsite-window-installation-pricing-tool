// Housecall Pro proxy — every call FieldPricer makes to Housecall Pro goes
// through here, so the HCP API key never reaches a browser.
//
// Phase 1 actions (admin only, all read-only against HCP):
//   status      → what's connected (no key, just last 4 / company / who / when)
//   connect     → { apiKey } test it against GET /company, then store it in Vault
//   test        → re-check the stored key against GET /company
//   disconnect  → delete the stored key
//   reference   → company locations, employees, job types, lead sources, tags
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
  if (p === '/tags') return { page: 1, total_pages: 1, total_items: 2, tags: [{ id: 'tag_mock_1', name: 'Residential' }, { id: 'tag_mock_2', name: 'Commercial' }] };
  throw new HcpError('unexpected', `Mock mode has no fixture for ${p}`);
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
    if (me.role !== 'admin') return json({ error: 'Only admins can manage the Housecall Pro connection.' }, 403);

    // Service role: reads/writes the Vault key and hcp_connection.
    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json().catch(() => ({}));

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

      default:
        return json({ error: `Unknown action: ${body.action}` }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

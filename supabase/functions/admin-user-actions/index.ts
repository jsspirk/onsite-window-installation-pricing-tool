// Admin user management — list users (with email, which `profiles` doesn't
// have) and delete a user. Both need the service-role key, so they can't
// happen from client-side code. Deactivate and password-reset don't need
// this function at all — they're plain client-side calls (a `profiles`
// update and the public `resetPasswordForEmail`, respectively).
//
// Deploy: supabase functions deploy admin-user-actions

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    // Scoped to the caller's own JWT — used only to verify who's asking and
    // that they're an admin, respecting normal RLS. Never used for the
    // actual privileged operations below.
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseCaller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await supabaseCaller.auth.getUser();
    if (userErr || !user) return json({ error: 'Invalid session' }, 401);

    const { data: callerProfile } = await supabaseCaller
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (callerProfile?.role !== 'admin') {
      return json({ error: 'Admin access required' }, 403);
    }

    // Service-role client for the actual privileged operations.
    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const body = await req.json().catch(() => ({}));

    if (body.action === 'list') {
      const { data: authData, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
      if (listErr) return json({ error: listErr.message }, 500);

      const { data: profiles, error: profErr } = await supabaseAdmin
        .from('profiles')
        .select('id, name, role, is_active');
      if (profErr) return json({ error: profErr.message }, 500);

      const profileMap = Object.fromEntries((profiles || []).map((p) => [p.id, p]));
      const users = authData.users.map((u) => ({
        id: u.id,
        email: u.email,
        name: profileMap[u.id]?.name || u.email,
        role: profileMap[u.id]?.role || 'tech',
        isActive: profileMap[u.id]?.is_active ?? true,
      }));
      return json({ users });
    }

    if (body.action === 'create') {
      const { email, password, name, role } = body;
      if (!email || !password) return json({ error: 'email and password are required' }, 400);
      if (role && role !== 'tech' && role !== 'admin') {
        return json({ error: "role must be 'tech' or 'admin'" }, 400);
      }

      // email_confirm: true skips the confirmation-email step entirely —
      // this is the admin-provisioning path, not self-signup, so there's
      // no email round-trip (and nothing to hit the project's email
      // rate limit).
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (createErr) return json({ error: createErr.message }, 500);

      const newId = created.user.id;
      const { error: profileErr } = await supabaseAdmin
        .from('profiles')
        .upsert({ id: newId, name: name || email, role: role || 'tech', is_active: true });
      if (profileErr) return json({ error: profileErr.message }, 500);

      return json({ user: { id: newId, email, name: name || email, role: role || 'tech', isActive: true } });
    }

    if (body.action === 'delete') {
      const targetId = body.userId;
      if (!targetId) return json({ error: 'userId is required' }, 400);
      if (targetId === user.id) return json({ error: "Can't delete your own account" }, 400);

      const { count: quoteCount, error: quoteErr } = await supabaseAdmin
        .from('quotes')
        .select('id', { count: 'exact', head: true })
        .eq('tech_id', targetId);
      if (quoteErr) return json({ error: quoteErr.message }, 500);
      if (quoteCount && quoteCount > 0) {
        return json(
          { error: `This user has ${quoteCount} quote${quoteCount === 1 ? '' : 's'} on file. Deactivate instead of deleting.` },
          400,
        );
      }

      const { data: targetProfile } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('id', targetId)
        .single();
      if (targetProfile?.role === 'admin') {
        const { count: adminCount, error: adminErr } = await supabaseAdmin
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'admin');
        if (adminErr) return json({ error: adminErr.message }, 500);
        if ((adminCount || 0) <= 1) {
          return json({ error: 'Cannot delete the last remaining admin.' }, 400);
        }
      }

      const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(targetId);
      if (delErr) return json({ error: delErr.message }, 500);
      return json({ success: true });
    }

    return json({ error: `Unknown action: ${body.action}` }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

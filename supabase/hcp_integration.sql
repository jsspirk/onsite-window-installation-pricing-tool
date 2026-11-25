-- =====================================================================
-- Housecall Pro integration — Phase 1 (connect / test / disconnect / reads)
--
-- Apply to STAGING first. Safe to re-run.
--
-- The HCP API key never lives in a table: it's stored encrypted in
-- Supabase Vault and is readable only through hcp_get_api_key(), which
-- only the service role (the hcp-proxy Edge Function) may execute.
-- hcp_connection holds display-only metadata (last 4 characters, company
-- name, who connected it). Admins can read it; nobody can write it from the
-- app — only the Edge Function, via the service role.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.hcp_connection (
  id             integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  key_last4      text,
  company_id     text,
  company_name   text,
  location_count integer,
  connected_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  connected_at   timestamptz,
  last_tested_at timestamptz,
  last_test_ok   boolean,
  last_error     text
);

ALTER TABLE public.hcp_connection ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read HCP connection" ON public.hcp_connection;
CREATE POLICY "Admins can read HCP connection" ON public.hcp_connection
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
-- Deliberately no INSERT/UPDATE/DELETE policies.

-- ---------------------------------------------------------------------
-- API key in Vault — service role only
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hcp_get_api_key() RETURNS text
  LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'hcp_api_key' LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.hcp_set_api_key(p_key text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE sid uuid;
BEGIN
  SELECT id INTO sid FROM vault.secrets WHERE name = 'hcp_api_key';
  IF sid IS NULL THEN
    PERFORM vault.create_secret(p_key, 'hcp_api_key', 'Housecall Pro API key (FieldPricer)');
  ELSE
    PERFORM vault.update_secret(sid, p_key);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.hcp_clear_api_key() RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  DELETE FROM vault.secrets WHERE name = 'hcp_api_key';
$$;

REVOKE ALL ON FUNCTION public.hcp_get_api_key()       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hcp_set_api_key(text)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hcp_clear_api_key()     FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hcp_get_api_key()     TO service_role;
GRANT EXECUTE ON FUNCTION public.hcp_set_api_key(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hcp_clear_api_key()   TO service_role;

-- ---------------------------------------------------------------------
-- Integration settings (destination, field mapping, team, sending rules)
-- One row of JSON. Everyone signed in can read it (techs need to know
-- whether they may send); only admins can change it. The Edge Function
-- also enforces the sending rules server-side.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hcp_settings (
  id         integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  settings   jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.hcp_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Signed-in users can read HCP settings" ON public.hcp_settings;
CREATE POLICY "Signed-in users can read HCP settings" ON public.hcp_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins can insert HCP settings" ON public.hcp_settings;
CREATE POLICY "Admins can insert HCP settings" ON public.hcp_settings
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS "Admins can update HCP settings" ON public.hcp_settings;
CREATE POLICY "Admins can update HCP settings" ON public.hcp_settings
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- ---------------------------------------------------------------------
-- Customer details + Housecall Pro link on quotes (step 2)
--   customer_details: { phone, email, street, city, state, zip }
--   hcp_link:         { customerId, customerName, addressId, workId, workKind, workNumber, linkedAt }
-- The app only writes these when a quote has them, so the live app keeps
-- working before this migration is applied there.
-- ---------------------------------------------------------------------
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS customer_details jsonb;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS hcp_link jsonb;

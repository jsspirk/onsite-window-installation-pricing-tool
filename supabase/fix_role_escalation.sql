-- =====================================================================
-- Fix: users could grant themselves admin (found 2026-11-24)
--
-- 1. handle_new_user() copied the role from client-supplied sign-up
--    metadata, so a public sign-up with {role: 'admin'} became an admin.
--    New accounts now always start as 'tech'. Admin-created accounts are
--    unaffected: the admin-user-actions Edge Function sets the real role
--    with the service-role key right after creating the user.
--
-- 2. The "Users can update their own profile" policy doesn't limit
--    columns, so any signed-in user could set their own role to 'admin'
--    (or re-activate their own deactivated account). A trigger now refuses
--    role / is_active changes unless the caller is an admin. Server-side
--    calls with no signed-in user (service role, SQL editor) still pass.
--
-- Safe to re-run. Apply to staging first, then production.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public'
AS $$
begin
  insert into public.profiles (id, name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    'tech'   -- never trust a role from sign-up metadata
  );
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public'
AS $$
begin
  if auth.uid() is not null
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  then
    raise exception 'Only admins can change a user''s role or active status'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

DROP TRIGGER IF EXISTS protect_profile_privileged_fields ON public.profiles;
CREATE TRIGGER protect_profile_privileged_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileged_fields();

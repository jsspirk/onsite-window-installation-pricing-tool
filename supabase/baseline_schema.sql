-- =====================================================================
-- FieldPricer baseline schema — structure only, no data.
-- Generated 2026-11-24 from the live project (qulbihqeiuupydhzvsao) with
-- `supabase db dump --schema public`, plus the pieces that live outside
-- the public schema (auth trigger, storage buckets + policies), read from
-- the live project the same day.
-- Used to stand up fieldpricer-staging (niajuaesxffhtfnsmwgd). Re-runnable
-- on an empty project; NOT meant to be run against production.
-- =====================================================================




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$                                                                                                                                                                            
  begin                                                     
    insert into public.profiles (id, name, role)
    values (                                                                                                                                                                                                                                                  
      new.id,
      coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),                                                                                                                                                                               
      coalesce(new.raw_user_meta_data->>'role', 'tech')     
    );                                                                                                                                                                                                                                                        
    return new;
  end;                                                                                                                                                                                                                                                        
  $$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."app_config" (
    "id" integer DEFAULT 1 NOT NULL,
    "brand_name" "text" DEFAULT 'FastGlass'::"text" NOT NULL,
    "brand_color" "text",
    "brand_logo_square_url" "text",
    "brand_logo_horiz_url" "text",
    "default_supplier" "text" DEFAULT 'busick'::"text" NOT NULL,
    "range_band" numeric DEFAULT 0.08 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "markup_tiers" "jsonb",
    "round_increment" integer DEFAULT 25,
    "mult_default" numeric DEFAULT 3,
    "mult_threshold" numeric,
    "mult_high" numeric DEFAULT 2,
    "price_catalog" "jsonb",
    CONSTRAINT "app_config_id_check" CHECK (("id" = 1))
);


ALTER TABLE "public"."app_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."manual_costs" (
    "id" "text" NOT NULL,
    "quote_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "cost" numeric DEFAULT 0 NOT NULL,
    "excluded" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."manual_costs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."panes" (
    "id" "text" NOT NULL,
    "quote_id" "text",
    "sort_order" integer DEFAULT 0,
    "thickness" "text",
    "coating" "text",
    "finish" "text",
    "grid" "text" DEFAULT 'none'::"text",
    "shape" "text" DEFAULT 'standard'::"text",
    "location" "text" DEFAULT ''::"text",
    "qty" integer DEFAULT 1,
    "width_whole" "text" DEFAULT ''::"text",
    "width_frac" "text" DEFAULT ''::"text",
    "height_whole" "text" DEFAULT ''::"text",
    "height_frac" "text" DEFAULT ''::"text",
    "width" numeric DEFAULT 0,
    "height" numeric DEFAULT 0,
    "unit" "text" DEFAULT 'in'::"text",
    "labor_hrs" numeric DEFAULT 1.0,
    "story_level" "text" DEFAULT 'ground'::"text",
    "unit_type" "text" DEFAULT 'double_pane'::"text",
    "excluded" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."panes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "role" "text" DEFAULT 'tech'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_active" boolean DEFAULT true NOT NULL,
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['tech'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quotes" (
    "id" "text" NOT NULL,
    "tech_id" "uuid",
    "tech_name" "text",
    "customer_name" "text",
    "customer_contact" "text",
    "contact_type" "text" DEFAULT 'phone'::"text",
    "job_date" timestamp with time zone,
    "job_num" "text" DEFAULT ''::"text",
    "notes" "text" DEFAULT ''::"text",
    "tools_required" "text" DEFAULT ''::"text",
    "status" "text" DEFAULT 'draft'::"text",
    "supplier" "text" DEFAULT 'busick'::"text",
    "total_product" numeric DEFAULT 0,
    "total_labor" numeric DEFAULT 0,
    "total_materials" numeric DEFAULT 0,
    "grand_total" numeric DEFAULT 0,
    "catalog_version" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "synced_at" timestamp with time zone,
    "agreed_price" numeric,
    "customer_approved" boolean DEFAULT false NOT NULL,
    "approved_at" timestamp with time zone,
    "signature_url" "text",
    CONSTRAINT "quotes_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'sent'::"text", 'shown'::"text", 'flagged'::"text", 'approved'::"text"])))
);


ALTER TABLE "public"."quotes" OWNER TO "postgres";


ALTER TABLE ONLY "public"."app_config"
    ADD CONSTRAINT "app_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."manual_costs"
    ADD CONSTRAINT "manual_costs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."panes"
    ADD CONSTRAINT "panes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quotes"
    ADD CONSTRAINT "quotes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_config"
    ADD CONSTRAINT "app_config_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."manual_costs"
    ADD CONSTRAINT "manual_costs_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."panes"
    ADD CONSTRAINT "panes_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quotes"
    ADD CONSTRAINT "quotes_tech_id_fkey" FOREIGN KEY ("tech_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



CREATE POLICY "Admins can delete all panes" ON "public"."panes" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete all quotes" ON "public"."quotes" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert all panes" ON "public"."panes" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can select all panes" ON "public"."panes" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can select all quotes" ON "public"."quotes" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update all quotes" ON "public"."quotes" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update any profile" ON "public"."profiles" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update config" ON "public"."app_config" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins delete quotes" ON "public"."quotes" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins manage all manual costs" ON "public"."manual_costs" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Authenticated users can read all profiles" ON "public"."profiles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can read config" ON "public"."app_config" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Delete panes for own quotes or admin" ON "public"."panes" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."quotes" "q"
  WHERE (("q"."id" = "panes"."quote_id") AND (("q"."tech_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."profiles"
          WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))))))));



CREATE POLICY "Insert panes for own quotes" ON "public"."panes" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."quotes" "q"
  WHERE (("q"."id" = "panes"."quote_id") AND ("q"."tech_id" = "auth"."uid"())))));



CREATE POLICY "Pane select mirrors parent quote" ON "public"."panes" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."quotes" "q"
  WHERE (("q"."id" = "panes"."quote_id") AND (("q"."tech_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."profiles"
          WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))))))));



CREATE POLICY "Techs insert own quotes" ON "public"."quotes" FOR INSERT TO "authenticated" WITH CHECK (("tech_id" = "auth"."uid"()));



CREATE POLICY "Techs manage manual costs on their own quotes" ON "public"."manual_costs" USING ((EXISTS ( SELECT 1
   FROM "public"."quotes"
  WHERE (("quotes"."id" = "manual_costs"."quote_id") AND ("quotes"."tech_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."quotes"
  WHERE (("quotes"."id" = "manual_costs"."quote_id") AND ("quotes"."tech_id" = "auth"."uid"())))));



CREATE POLICY "Techs read own quotes, admins read all" ON "public"."quotes" FOR SELECT TO "authenticated" USING ((("tech_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text"))))));



CREATE POLICY "Techs update own quotes, admins update all" ON "public"."quotes" FOR UPDATE TO "authenticated" USING ((("tech_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text"))))));



CREATE POLICY "Update panes for own quotes or admin" ON "public"."panes" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."quotes" "q"
  WHERE (("q"."id" = "panes"."quote_id") AND (("q"."tech_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."profiles"
          WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))))))));



CREATE POLICY "Users can update their own profile" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id"));



ALTER TABLE "public"."app_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."manual_costs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."panes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."quotes" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON TABLE "public"."app_config" TO "anon";
GRANT ALL ON TABLE "public"."app_config" TO "authenticated";
GRANT ALL ON TABLE "public"."app_config" TO "service_role";



GRANT ALL ON TABLE "public"."manual_costs" TO "anon";
GRANT ALL ON TABLE "public"."manual_costs" TO "authenticated";
GRANT ALL ON TABLE "public"."manual_costs" TO "service_role";



GRANT ALL ON TABLE "public"."panes" TO "anon";
GRANT ALL ON TABLE "public"."panes" TO "authenticated";
GRANT ALL ON TABLE "public"."panes" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."quotes" TO "anon";
GRANT ALL ON TABLE "public"."quotes" TO "authenticated";
GRANT ALL ON TABLE "public"."quotes" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";








-- ---------------------------------------------------------------------
-- Outside the public schema
-- ---------------------------------------------------------------------

-- New auth users get a profiles row (see handle_new_user above)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES
  ('brand-assets', 'brand-assets', true),
  ('signatures',   'signatures',   false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies (mirrors live)
DROP POLICY IF EXISTS "Public read brand assets" ON storage.objects;
CREATE POLICY "Public read brand assets" ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'brand-assets');

DROP POLICY IF EXISTS "Admins can upload brand assets" ON storage.objects;
CREATE POLICY "Admins can upload brand assets" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'brand-assets'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

DROP POLICY IF EXISTS "Admins can update brand assets" ON storage.objects;
CREATE POLICY "Admins can update brand assets" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'brand-assets'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

DROP POLICY IF EXISTS "Admins can delete brand assets" ON storage.objects;
CREATE POLICY "Admins can delete brand assets" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'brand-assets'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

DROP POLICY IF EXISTS "Authenticated read signatures" ON storage.objects;
CREATE POLICY "Authenticated read signatures" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'signatures');

DROP POLICY IF EXISTS "Authenticated upload signatures" ON storage.objects;
CREATE POLICY "Authenticated upload signatures" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'signatures');

DROP POLICY IF EXISTS "Authenticated update signatures" ON storage.objects;
CREATE POLICY "Authenticated update signatures" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'signatures');

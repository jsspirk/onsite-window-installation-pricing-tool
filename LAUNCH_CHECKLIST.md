# Launch & Productionization Checklist

Grounded in the current codebase as of 2026-08-06 (single-file vanilla JS PWA,
Supabase backend, GitHub Pages hosting). Organized in three tiers:

1. **Must-do before real customer/field use**
2. **Should-do soon after launch** (won't block go-live, but real gaps)
3. **Reuse-for-other-clients architecture** (decide before taking on a second client)

Check items off in place as they're completed — this file is meant to live in
the repo and travel with the code, not go stale in a chat.

---

## 1. Must-do before launch

### Security & accounts
- [ ] Remove or rotate the demo accounts (`tech1@demo.com`, `CJ@demo.com`,
      `eric@demo.com`, `demopass`-set `Dev Test`) — these currently work
      against the real production database with real quote data.
- [ ] Decide whether public self-signup should be possible at all. Right now
      accounts are only created via admin invite (`admin-user-actions`
      `create`/`invite`) — confirm there's no other path that creates a
      `profiles` row with default access.
- [ ] Audit Supabase RLS policies directly in the dashboard (not just from
      memory of what they're supposed to do) — confirm techs truly can't
      read/write other techs' quotes, and that `panes`/`quotes`/`profiles`
      all have RLS *enabled*, not just policies defined.
- [x] Confirm Auth → URL Configuration (Site URL + Redirect URLs) is correct
      for the real production domain — this already bit us once
      ([[project_fastglass]] has the incident). If the domain changes
      before launch, this needs updating again. **Done 2026-08-07** —
      updated to `fieldpricer.com` when the custom domain went live.
- [ ] Review the default Supabase email templates (password reset, invite) —
      they're currently unbranded Supabase defaults, not FastGlass-branded.
- [ ] Confirm minimum password length / password policy matches what you
      actually want field techs to use (currently blocks anything under 6
      chars — the `weak_password` error we hit this session).

### Data safety
- [ ] Turn on Supabase's automated backups (point-in-time recovery needs a
      paid plan tier — confirm current plan covers it).
- [ ] Write down (even briefly) what "restore from backup" actually looks
      like, so it's not being figured out for the first time during an
      incident.
- [ ] Decide a retention/deletion policy for old quotes and signature
      images in the `signatures` storage bucket — nothing currently expires
      or gets cleaned up.

### Reliability
- [ ] Add error monitoring (e.g. Sentry's browser SDK — single `<script>`
      tag away, no build step needed). Right now a JS error in the field
      is invisible to you; you'd only hear about it from a tech.
- [ ] Add uptime monitoring for the GitHub Pages URL and the Supabase
      project (a simple pinger is enough at this scale).

### Legal / compliance
- [ ] Terms of Service + Privacy Policy — the app collects customer names,
      contact info, and captured signatures. Even a simple policy page is
      better than none once real customers are signing on real devices.
- [ ] Confirm the in-app signature capture meets whatever legal bar you
      need for a binding acceptance (ESIGN Act / UETA if US-based) —
      this is a business/legal question, not a code one, but worth
      answering before treating a captured signature as a real approval.

### Polish
- [ ] `README.md` is stale — it references `tech1 / demo` and `admin / demo`
      logins with no `@demo.com`, from before Supabase Auth replaced the
      old fake login. Rewrite it to reflect current setup (Supabase project,
      how to run tests, how to deploy).
- [ ] Real PWA installability: there's currently no `manifest.json` and no
      service worker, despite being referred to as a PWA. Add a manifest
      (name, icons, theme color pulling from `app_config.brand_color`) and
      a minimal service worker for the app shell if "Add to Home Screen"
      on a job site matters to you.
- [x] Custom domain instead of the `github.io` subdomain, if this is going
      in front of real customers — cheap credibility win, and gives you a
      stable domain to put in the Supabase Auth Redirect URL list instead
      of chasing it if hosting ever changes. **Done 2026-08-07** —
      `fieldpricer.com` live via GitHub Pages + Cloudflare DNS (verified
      serving 200 over HTTPS).

---

## 2. Should-do soon after launch

- [ ] Expand automated test coverage beyond the pricing engine.
      `tests/run_tests.js` (120 tests) only covers `calcPane`/`calcJob`/
      `rangeBounds` — every UI flow bug found this session (button copy,
      button focus, route-restoration, signature URL patching) was only
      caught by manual/Playwright verification, not the test suite. Worth
      turning at least the highest-value flows from this session's
      Playwright scripts into a standing regression suite instead of
      one-off scratchpad scripts.
- [ ] Real device testing — this is a field tool used on phones outdoors.
      Test on actual iOS Safari and Android Chrome, not just desktop
      Chromium headless, including outdoor-brightness legibility and
      touch-target sizing.
- [ ] Basic accessibility pass (contrast, focus states, tap target sizes)
      — no explicit pass has been done.
- [ ] Decide a rollback plan for a bad deploy. Currently: `git revert` +
      push, GitHub Pages redeploys automatically. That's fine, but there's
      no staging environment — every push goes straight to what techs are
      using in the field. Worth deciding if that's acceptable long-term or
      if a staging branch/URL is worth the small setup cost.
- [ ] Outstanding pricing-accuracy questions from the accuracy eval are
      still unresolved with CJ (see `project_fastglass` memory /
      `tests/pricing_accuracy_eval.js`) — worth closing out before those
      edge cases show up on a real customer quote.

---

## 3. Reuse-for-other-clients architecture

This is the one that needs a real decision, not just a task list — the
codebase today is **single-tenant by construction**, and how far to
generalize it depends on how soon a second client is real.

### The core blocker
~~`PRICE_CATALOG` (suppliers, $/SF rate tables, grid adders, shape
multipliers, glass weights, coating options) is hardcoded in `index.html`
(~line 1190+). This is FastGlass-specific business data with no admin UI —
unlike `markup_tiers`, `min_job_cost`, and branding, which already live in
`app_config` and are admin-editable. A second client with different
suppliers or rate structures currently means editing JS by hand, not
configuring the app.~~ **Resolved 2026-08-06** — `PRICE_CATALOG` now lives
in `app_config.price_catalog` (jsonb) with a full admin editor (Glass
Types tab: per-supplier drill-down for rates/grid adder/markup; Labor &
Pricing: labor rates; Materials: shape multipliers, glass weights, and
heavy-lift thresholds). A new client's catalog is now a database
seed/admin edit, not a code change.

- [ ] **Decide the reuse model** before building anything further:
  - **Fork-per-client**: each client gets their own Supabase project +
    their own deploy, from a shared template repo. Simple, no
    cross-tenant risk, but N clients = N codebases to keep in sync by
    hand (or via a template-sync process).
  - **True multi-tenant SaaS**: one app, one (or sharded) Supabase
    backend, tenant-scoped data and RLS. More work up front (schema
    needs a `tenant_id`/`org_id` on every table, RLS policies need to key
    off it, auth needs to resolve which org a user belongs to), but scales
    without manual repo-syncing.
  - Given there's currently exactly one client, **fork-per-client with a
    clean template is almost certainly the right starting point** —
    don't build multi-tenant infrastructure speculatively. Revisit this
    once a second client is actually signed.
- [x] Move `PRICE_CATALOG` into `app_config` (jsonb, same pattern as
      `markup_tiers`) with an admin editor UI, regardless of which reuse
      model you pick — this is valuable even for FastGlass alone (Joe/Eric
      could adjust supplier rates without a code deploy) and is the single
      highest-leverage change for reusability. **Done 2026-08-06.**
- [ ] Parameterize `SUPABASE_URL` / `SUPABASE_KEY` (currently hardcoded
      constants at the top of `index.html`, line ~1179) so a new client
      deployment is "swap two values," not "edit and diff the file."
- [ ] Audit for any other hardcoded FastGlass-specific strings/assumptions
      beyond the catalog — `brand_name`, logos, and colors are already
      config-driven; confirm coating types, unit types (single/double/
      triple pane), and shape options are genuinely industry-standard
      across glass/window installers and not FastGlass-specific
      terminology that a new client would need changed in code.
- [ ] Write a short "new client setup" runbook once the above is done:
      create Supabase project → run schema migrations → seed `app_config`
      (branding + catalog) → create admin account → deploy. This turns
      "productize" from an aspiration into a repeatable checklist of its
      own.
- [ ] If multi-tenant SaaS is ever chosen over fork-per-client, that's a
      real schema migration (tenant_id everywhere, RLS rewrite) — treat it
      as its own dedicated phase, not a bolt-on.

# TCI ERP — Mosaic Insurance Group

ERP for the Trade Credit Insurance line of business. React + TypeScript + Vite frontend, Supabase (PostgreSQL + Auth + RLS) backend, deployed to Cloudflare Pages. See [CLAUDE.md](CLAUDE.md) for the full product vision and conventions.

## Local development

```bash
npm install
cp .env.example .env    # fill in your Supabase project URL and anon key
npm run dev
```

Useful scripts:

| Command             | Purpose                                |
| ------------------- | -------------------------------------- |
| `npm run dev`       | Vite dev server                        |
| `npm run build`     | Type-check (`tsc -b`) + production build |
| `npm run typecheck` | Type-check only                        |
| `npm run lint`      | ESLint                                 |
| `npm run format`    | Prettier                               |

## Supabase

All TCI tables live in the dedicated Postgres schema **`tci`** (never `public`). Schema changes go through migration files in `supabase/migrations/` only — never edit schema via the dashboard.

### Link the project and apply migrations

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

### Expose the `tci` schema to the API

The Supabase client queries `tci` via PostgREST, so the schema must be listed in the exposed schemas:

- **Hosted project:** Dashboard → Settings → API → "Exposed schemas" → add `tci` (keep `public`, `graphql_public`).
- **Local dev (`npx supabase start`):** already configured in `supabase/config.toml` (`api.schemas`).

### Create the first users

There is no self-signup. Create users in Dashboard → Authentication → Users ("Add user"), then assign a role (run in SQL editor):

```sql
insert into tci.user_roles (user_id, role)
values ('<auth-user-uuid>', 'admin');
```

Roles: `admin`, `senior_underwriter`, `underwriter`, `policyholder`.

## Cloudflare Pages deploy

Connect the GitHub repo to Cloudflare Pages with:

- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Environment variables:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

SPA routing is handled by `public/_redirects` (`/* /index.html 200`), which is copied into `dist` at build time.

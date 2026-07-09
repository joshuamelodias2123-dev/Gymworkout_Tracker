# 🏋 Workout Tracker

A small, dependency-light workout logger. Log sessions, build reusable routines,
and chart your progress over time. Data is stored in **Supabase** behind
per-user Row Level Security, so your workouts follow you across devices.

Plain HTML, CSS, and vanilla JS — no build step, no framework, no bundler.

## Features

- **Log Workout** — pick a date, add exercises, record weight × reps per set. Shows what you lifted last time for the same exercise.
- **History** — collapsible session list, filterable by exercise.
- **Progress** — top-set weight and session volume charted over time, plus personal bests.
- **Exercises & Routines** — manage your exercise library and save reusable workout templates.
- **Settings** — export a JSON backup, import one back, or erase everything.

## Running it

There's no build step. Any static file server works:

```bash
npx --yes http-server . -p 4173 -c-1
# then open http://localhost:4173
```

Opening `index.html` directly off the filesystem (`file://`) also mostly works,
but a local server is recommended so Supabase auth redirects behave normally.

## Configuration

`config.js` holds the Supabase project URL and publishable key.

The publishable key is **safe to commit and expose** in client-side code. Every
table has Row Level Security enabled, and every policy requires
`auth.uid() = user_id`. The key alone grants access to zero rows — this is
verified: an unauthenticated client reads 0 rows and its inserts are rejected
with `new row violates row-level security policy`.

Never put the `service_role` key in this repo. That one bypasses RLS entirely.

## Database schema

Six tables, all owned by `auth.users(id)` via a `user_id` column that defaults
to `auth.uid()`, all with RLS enabled.

```
exercises          id, user_id, name, category, archived
routines           id, user_id, name
routine_exercises  id, user_id, routine_id → routines, exercise_id → exercises, position
sessions           id, user_id, date, routine_id → routines (nullable), notes
session_entries    id, user_id, session_id → sessions, exercise_id → exercises, position
sets               id, user_id, entry_id → session_entries, set_index, weight, reps
```

Deletes cascade downward: removing a session removes its entries and their sets.
Deleting your `auth.users` row removes everything you own.

### Why `archived` exists

`session_entries.exercise_id` uses `ON DELETE RESTRICT`, so an exercise with
logged history can't be hard-deleted without destroying that history. When you
delete such an exercise the app sets `archived = true` instead: it disappears
from every dropdown but your past sessions still render its name. Re-adding an
exercise with the same name un-archives the original row rather than colliding
with the unique index on `(user_id, lower(name))`.

## Auth

Email + password, via Supabase Auth.

**Email confirmation is currently ON** for this project, which means a new signup
must click a link in their inbox before they can sign in. Two things to know:

1. Supabase's built-in email sender is heavily rate limited and is really only
   intended for testing. For real use, configure your own SMTP provider under
   **Authentication → Emails** in the dashboard.
2. If this is a personal, single-user app, it's simpler to turn confirmation off:
   **Authentication → Sign In / Providers → Email → Confirm email → off**.
   Signup then logs you straight in.

Supabase also flags that **leaked password protection** is disabled. Turning it
on (Authentication → Policies) checks new passwords against HaveIBeenPwned.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup: auth screen + the five app tabs |
| `styles.css` | All styling, dark theme |
| `app.js` | Auth, data loading, rendering, and every Supabase write |
| `config.js` | Supabase URL + publishable key |

`app.js` keeps an in-memory mirror of your rows in `state`, loaded once on sign-in
and patched on each write, so rendering stays synchronous and snappy.

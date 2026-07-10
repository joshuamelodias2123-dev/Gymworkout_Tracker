# Pulseline

*your progress, in rhythm*

A workout logger. Log sessions, build reusable routines, and chart your progress
over time. Data is stored in **Supabase** behind per-user Row Level Security, so
your workouts follow you across devices.

Plain HTML, CSS, and vanilla JS — no build step, no framework, no bundler.

## Features

- **Log** — a week strip for picking the session date (days with a logged workout get a coral ring), optional routine, then weight × reps per set. Shows what you lifted last time for the same exercise.
- **History** — collapsible past sessions, filterable by exercise.
- **Progress** — a ring showing your latest top set as a fraction of your all-time best, macro-style bars, personal-best tiles, and a dual-axis weight/volume chart.
- **Library** — manage your exercise catalogue and reusable routines.
- **Account** — export a JSON backup, import one back, or erase everything.

## Running it

No build step. Any static file server works:

```bash
npx --yes http-server . -p 4173 -c-1
# then open http://localhost:4173
```

## Brand

| Token | Value | Used for |
| --- | --- | --- |
| bg | `#0B0C10` | page background |
| panel / panel-2 / panel-3 | `#15171E` / `#1B1E27` / `#232733` | cards, inputs, ring track |
| border | `#262A34` | hairlines |
| text / dim | `#F2F3F5` / `#8B92A0` | copy |
| accent | `#FF4D5E` | coral — primary actions, top-set ring |
| teal | `#4FD6C0` | volume |
| amber | `#FFB454` | reps |
| purple | `#8B7CFF` | tertiary bars |

Wordmark is Poppins, falling back to the system sans.

### The logo

A tapered heartbeat line that fades to a point at both ends: small blip → tall
spike → deep valley → small blip. A plain SVG stroke has one uniform width and
cannot taper, so `brand/pulse.py` treats the mark as a *centerline* of
`(x, y, half_width)` key points, smooths it with a Catmull-Rom spline, offsets
each sample along its normal, and emits a single filled outline path.

```bash
python brand/pulse.py
```

Edit `KEY` in that script and re-run to reshape the mark. It writes:

| File | Purpose |
| --- | --- |
| `pulse_path.txt` | full-density path, for large renders |
| `pulse_path_compact.txt` | decimated path, ~3.5× smaller |
| `pulseline-mark.svg` | the coral mark used in the header, auth screen, and favicon |

`brand/preview.html` renders the mark at three sizes against the app background —
handy when tweaking `KEY`.

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

## Rendering notes

Two traps worth not re-introducing:

- **The progress ring is drawn on a raw Canvas 2D context**, and its logical size
  lives in a `data-size` attribute. Reading back the mutated `canvas.width` on
  each redraw would compound the `devicePixelRatio` scale and the ring would grow
  every render.
- **Build the ring and the chart canvas in one `innerHTML` assignment.** An
  `innerHTML +=` re-parses the whole subtree and replaces the canvas you already
  painted with a blank one.

Only the line chart uses Chart.js from a CDN, and it degrades gracefully: if the
CDN is unreachable the stats still render with a note explaining the chart needs
a connection the first time.

## Auth

Email + password, via Supabase Auth.

**Email confirmation is OFF**, so signup logs you straight in and no mail is
sent. That is the right setting for a personal, single-user app, and it sidesteps
Supabase's built-in sender — which allows only ~2 messages per hour and returns
`429: over_email_send_rate_limit` once you exceed it.

If you ever open this up to other people, turn confirmation back on
(**Authentication → Sign In / Providers → Email → Confirm email**) *and* configure
your own SMTP provider under **Authentication → Emails**. The built-in sender is
for testing only and will not survive real signups.

Supabase also flags that **leaked password protection** is disabled. Turning it
on checks new passwords against HaveIBeenPwned.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Auth screen, five tabs, bottom nav |
| `styles.css` | All styling |
| `app.js` | Auth, data loading, rendering, every Supabase write |
| `config.js` | Supabase URL + publishable key |
| `brand/` | Logo generator, generated paths, mark preview |

`app.js` keeps an in-memory mirror of your rows in `state`, loaded once on
sign-in and patched on each write, so rendering stays synchronous.

## Not built

Nutrition tracking, a calendar month view, and a gyms/map tab are **not** part of
this app. A live gym map would need a maps API key. Both would be real features,
not styling.

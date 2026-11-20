# Stellr

**From your backyard to the edge of the observable universe.**

Stellr is a family of space tools that run in the browser: live satellites, near-Earth asteroids,
sky events and space weather in real-time 3D, a map of the solar system as it is right now, and a
lab for finding planets around other stars in real NASA data. Every tool is free and works
without an account.

Live at **[stellr-coral.vercel.app](https://stellr-coral.vercel.app)**.

## The tools

| Tool | Path | What it does | Data |
| --- | --- | --- | --- |
| Orbit Watch | `/orbit-watch` | Satellites and the ISS, live, with passes over your location | CelesTrak TLEs, propagated with SGP4 |
| Asteroid Sentinel | `/asteroid-sentinel` | Near-Earth asteroids on approach, a year ahead; look up any asteroid; every potentially hazardous asteroid on its orbit | JPL CAD, SBDB, Sentry |
| Sky Events | `/sky-events` | Meteor showers, eclipses, conjunctions and launches, timed for your sky | astronomy-engine, Launch Library 2 |
| Space Weather | `/space-weather` | Solar wind, flares, geomagnetic storms and aurora odds | NOAA SWPC |
| Cosmoscope | `/cosmoscope` | The Sun, planets, Pluto, twenty moons and four spacecraft where they really are, at any moment; realistic shading (Earth's night lights and plates, Jupiter's polar cyclones, Saturn's hexagon and ring shadows); a full profile of each world below the 3D view; true-scale view; layers; panels can be hidden (`H`) | astronomy-engine, JPL Horizons, NASA fact sheets, PB2002 plate boundaries |
| Exoplanet Lab | `/exoplanet-lab` | Pull a star's TESS light curve, search it for transits, vet the signal and see what the world would be like | MAST (TESS), NASA Exoplanet Archive |
| Wobble | `/wobble` | A research agent that searches TESS stars for planets every day and keeps a notebook. **Private**, behind a password | MAST, NASA Exoplanet Archive |

The landing page (`/`) is a scroll-driven 3D journey from a night launch out past the galaxy,
with your local sky and the tools along the way. Signing in with Google (`/account`) gives a
profile; `/privacy` and `/terms` say what is kept.

### Exoplanet Lab in more detail

1. **Light curve.** Each TESS sector from the best pipeline that has it: the mission's own
   2-minute light curves (SPOC), then full-frame-image light curves from TESS-SPOC and MIT's
   Quick-Look Pipeline (QLP), which cover far more stars and sectors. Good-quality points,
   normalised and binned to 10 minutes, with the star's light centre (centroid) where the file
   has it. Read straight from the FITS files on MAST.
2. **Clean-up.** A sliding Tukey biweight filter (as in Wōtan, Hippke et al. 2019) removes the
   star's slow variations. Once a signal is found, the curve is cleaned again with its transits
   kept out of the trend, so they aren't partly flattened away.
3. **Period search.** Box Least Squares (Kovács et al. 2002) in a Web Worker, scored by SDE
   and SNR, then a transit-shaped refit around the peak, after Transit Least Squares (Hippke &
   Heller 2019): sloped ingress and egress and a limb-darkened bottom, for truer depths and
   durations. Found signals are masked to search for more, and lone dips that never repeat are
   listed separately (a long orbit can cross only once).
4. **Checks.** Odd/even depth, secondary eclipse, V-shape, depth, duration against the longest
   transit the star allows, implied size, variability away from the dip, number of transits, a
   centroid check (does the light's centre move during the dip, as when a neighbouring star is
   the one dimming?), and cross-matches with known planets and TESS Objects of Interest.
5. **ML vetter.** A gradient-boosted tree model trained on labelled Kepler and TESS signals from
   the NASA Exoplanet Archive scores how planet-like the signal is (held-out TESS AUC 0.91). It
   sees only period, depth, duration and the star, so each failed check then cuts its odds
   tenfold ("after the checks").
6. **The world.** Radius, orbit, insolation, equilibrium temperature, habitable zone and an
   illustration from the fitted numbers. Planets known only from radial velocity get a predicted
   radius (Chen & Kipping 2017) and transit odds.

A signal that passes is called a **candidate**, never a planet: confirming one needs follow-up
that Stellr can't do.

## Tech

- [Next.js 16](https://nextjs.org) (App Router, Cache Components) and React 19, TypeScript,
  Tailwind CSS 4
- three.js with React Three Fiber, drei and postprocessing; GSAP and Lenis for the scroll journey
- astronomy-engine and satellite.js for positions computed in the browser
- Upstash Redis over its REST API for accounts, Wobble's notebook and rate limits
- Vercel for hosting and cookie-free analytics; GitHub Actions for Wobble and model training

### Quality tiers

3D quality is picked from the device (GPU, cores, memory, reduced motion, data saver). Force it
with `?quality=low`, `?quality=medium` or `?quality=high`. **Use `?quality=low` on weak or
integrated GPUs.** Without WebGL the landing page falls back to still images
(`public/fallback/`).

## Running it locally

Requires Node.js 20 or later.

```bash
npm install
npm run dev        # http://localhost:3000
npm run lint
npm run build && npm start
```

All the public tools work with no configuration. Accounts and Wobble need the variables below.

## Configuration

Set these in Vercel → Settings → Environment Variables, then redeploy.

| Variable | Needed for |
| --- | --- |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (or Vercel's `KV_REST_API_URL`, `KV_REST_API_TOKEN`) | Accounts, Wobble's notebook, rate limits |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Sign in with Google |
| `AUTH_SECRET` (optional) | Signs account sessions; defaults to the Google client secret |
| `WOBBLE_PASSWORD` | Opens Wobble. Changing it signs everyone out |
| `WAITLIST_ADMIN_TOKEN` (optional) | Exports the closed waitlist |

Variables ending in `_BASE` (`CELESTRAK_BASE`, `JPL_BASE`, `SWPC_BASE`, …) and `GOOGLE_*_URL`
exist only so tests can point the server at local stand-ins. Leave them unset.

### Sign in with Google

1. [Google Cloud Console](https://console.cloud.google.com/) → Google Auth Platform →
   **Branding**: app name, support and developer emails, home page, privacy policy
   (`/privacy`) and terms (`/terms`) links, and the site's domain under Authorised domains.
   Don't upload a logo unless you want to go through Google's verification.
2. **Clients** → Create client → Web application. Authorised redirect URI:
   `https://<your domain>/api/auth/google/callback`.
3. **Audience** → Publish app.
4. Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to Vercel and redeploy.

Until both Google variables and Redis are set, `/account` says sign-in isn't switched on yet.
Sign-in uses the authorization-code flow with PKCE; Stellr keeps only the account id, name, email
and picture, and an account can be deleted from its page.

### Wobble

Wobble runs in GitHub Actions (`.github/workflows/wobble.yml`), daily at 02:41 UTC or on demand.
Each run picks stars (three quarters stars nobody has checked, from both the 2-minute and the
full-frame-image targets, preferring those TESS watched in two or more sectors; a quarter TESS
planet candidates), searches up to six sectors each with Exoplanet Lab's pipeline, and writes what it finds to Redis. The
repository is public, so findings never go into the repo or the Actions logs; the logs show
counts only.

It needs repository secrets `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, and
`WOBBLE_PASSWORD` in Vercel for the page. `WOBBLE_TARGETS` sets stars per run (default 8). To try
it locally without Redis, pass a file to write to:

```bash
npx tsx scripts/wobble.ts wobble-test.json
```

### The exoplanet vetter

`scripts/train_vetter.py` trains the vetter on the NASA Exoplanet Archive's labelled Kepler and
TESS signals and writes `public/models/vetter.json`, which the browser scores. The
`train-vetter.yml` workflow retrains it monthly and commits the model if it changed.

### Closed waitlist

The waitlist is closed. Emails collected earlier stay in Redis (`waitlist:emails`) and can be
exported as CSV from `/api/waitlist/export?token=<WAITLIST_ADMIN_TOKEN>`. Without the token set,
the route returns 404.

## Project layout

```
app/                 pages (one folder per tool) and API routes (app/api/*)
components/          tool UIs, landing-page sections (sections/), 3D scenes (canvas/)
lib/                 astronomy, orbits, transit search, vetter, auth, Redis helpers, workers
scripts/             wobble.ts (the agent), train_vetter.py (the model)
public/              textures, the Saturn V model, the vetter model, fallback images
.github/workflows/   Wobble and vetter training
```

## Credits

- Data: NASA, JPL (CAD, SBDB, Sentry, Horizons), NOAA SWPC, CelesTrak, Launch Library 2 (The
  Space Devs), MAST (TESS) and the NASA Exoplanet Archive.
- Planet and star textures by [Solar System Scope](https://www.solarsystemscope.com/textures/),
  licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Saturn V model by [NASA 3D Resources](https://science.nasa.gov/3d-resources/), repainted. No
  endorsement implied.
- Earth's plate boundaries: Peter Bird (2003), PB2002, via [Hugo Ahlenius, Nordpil](https://github.com/fraxen/tectonicplates),
  licensed ODC-By 1.0.
- Positions from [astronomy-engine](https://github.com/cosinekitty/astronomy) and
  [satellite.js](https://github.com/shashwatak/satellite-js).

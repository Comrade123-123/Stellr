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
| Cosmoscope | `/cosmoscope` | Planets, Pluto, major moons and spacecraft where they really are, at any moment ±10 years; true-scale view; hazardous-asteroid layer; panels can be hidden (`H`) | astronomy-engine, JPL Horizons |
| Exoplanet Lab | `/exoplanet-lab` | Pull a star's TESS light curve, search it for transits, vet the signal and see what the world would be like | MAST (TESS), NASA Exoplanet Archive |
| Wobble | `/wobble` | A research agent that searches TESS stars for planets every day and keeps a notebook. **Private**, behind a password | MAST, NASA Exoplanet Archive |

The landing page (`/`) is a scroll-driven 3D journey from a night launch out past the galaxy,
with your local sky and the tools along the way. Signing in with Google (`/account`) gives a
profile; `/privacy` and `/terms` say what is kept.

### Exoplanet Lab in more detail

1. **Light curve.** TESS 2-minute light curves (PDCSAP flux, good-quality points) are read
   straight from the FITS files on MAST, normalised and binned to 10 minutes.
2. **Period search.** A running-median filter flattens the curve, then Box Least Squares
   (Kovács et al. 2002) searches it in a Web Worker, scored by SDE and SNR. Found signals can be
   masked to search for more.
3. **Checks.** Odd/even depth, secondary eclipse, V-shape, depth, duration against the longest
   transit the star allows, implied size, variability away from the dip, number of transits, and
   cross-matches with known planets and TESS Objects of Interest.
4. **ML vetter.** A gradient-boosted tree model trained on labelled Kepler and TESS signals from
   the NASA Exoplanet Archive scores how planet-like the signal is (held-out TESS AUC 0.91).
5. **The world.** Radius, orbit, insolation, equilibrium temperature, habitable zone and an
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
Each run picks stars (half TESS planet candidates, half stars nobody has checked), searches up to
three sectors each with Exoplanet Lab's pipeline, and writes what it finds to Redis. The
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
- Positions from [astronomy-engine](https://github.com/cosinekitty/astronomy) and
  [satellite.js](https://github.com/shashwatak/satellite-js).

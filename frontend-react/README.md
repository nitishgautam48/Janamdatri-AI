# Janamdatri AI — Vite + React frontend

A ground-up rewrite of `frontend/` (vanilla JS) in Vite + React + Tailwind,
in a dark, Vaadhan-inspired design system, adapted for a maternal-health
context. It talks to the same existing FastAPI backend (`src/api/main.py`)
- no backend changes.

**Status: feature-complete.** Every screen from the original app has a
React equivalent: Home, Assessment, Pregnancy Guide, Nutrition, Mental
Wellness (EPDS), Postpartum Care, History (with real SVG trend
sparklines), Reports, My Profile, Helplines, Privacy & Consent Centre,
the Provider share-code lookup, and the Instant Help chat widget
(rebuilt as a corner-anchored drawer instead of the old full-viewport
panel that overlapped the nav bar).

Not yet wired into `src/api/main.py`'s static serving - `frontend/` is
still the deployed frontend. Cutting over means changing the static
mount/serve target in `main.py` to `frontend-react/dist` once this has
had a full manual QA pass in the deployed environment.

## Dev

```
npm install
npm run dev      # http://localhost:5173, proxies API calls to :8500
```

Run the FastAPI backend separately on port 8500 (`uvicorn src.api.main:app --port 8500`).

## Build

```
npm run build     # outputs dist/
```

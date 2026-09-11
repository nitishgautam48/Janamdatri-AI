# Janamdatri AI — Vite + React frontend (in progress)

A ground-up rewrite of `frontend/` (vanilla JS) in Vite + React + Tailwind,
in a dark, Vaadhan-inspired design system, adapted for a maternal-health
context. It talks to the same existing FastAPI backend (`src/api/main.py`)
- no backend changes.

**Status: phase 1.** Built and working: design system, app shell/nav,
auth (login/signup/guest), the chat widget (rebuilt as a proper
corner-anchored drawer instead of the old full-viewport panel that
overlapped the nav bar), the Home dashboard, and the Provider
share-code lookup page. Every other screen (Assessment, Pregnancy
Guide, Nutrition, Mental Wellness, Postpartum, History, Reports,
Profile, Helplines, Privacy Centre) is a labeled placeholder for now -
those still work in the original `frontend/`.

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

Not yet wired into `src/api/main.py`'s static serving - `frontend/` is
still the deployed frontend until this rewrite is complete.

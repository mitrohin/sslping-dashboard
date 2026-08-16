# SSLPing Dashboard

Production-oriented Vite/React dashboard for the SSLPing monitoring platform. It mirrors the workflows from the supplied UptimeRobot references while using SSLPing's own visual language and backend contract.

## Included functionality

- authentication, registration, e-mail verification, password reset and 2FA;
- workspace-aware session lifecycle with access-token refresh;
- HTTP/keyword monitors with optional TLS-certificate and domain-expiry checks, plus TCP, UDP, DNS, reachability and heartbeat monitors;
- monitor creation, editing, pause/resume, test checks, deletion, response metrics, evidence and incident history;
- incidents, maintenance windows and branded public status pages;
- team invitations and member management;
- Slack, Telegram, webhook and other notification integrations;
- API keys, audit-ready models and responsive public status pages;
- customer support tickets with threaded replies;
- a role-protected system-administration console for users, workspaces,
  enforceable plan limits, audited support impersonation and support alerts;
- GDPR cookie preferences and status-page subscription consent;
- desktop, tablet and mobile layouts with keyboard-accessible controls.

The backend API is expected in the sibling `../backend` repository. During development, Vite proxies `/v1`, `/health` and `/openapi.yaml` to `http://127.0.0.1:8080`.

## Run locally

Requirements: Node.js 20+ and the SSLPing backend running on port `8080`.

```bash
npm install
cp .env.example .env
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). In development, the login screen contains a link to the complete deterministic demo. It can also be opened directly at `/demo`; demo actions stay in the browser and never call the backend.

## Environment

```dotenv
# Leave empty to use the same-origin Vite proxy.
VITE_API_URL=

# Enables the local demo entry in a production build when explicitly needed.
VITE_DEMO_MODE=false
VITE_TURNSTILE_SITE_KEY=
VITE_PROBLEM_REPORT_METADATA_URL=/problem-report-metadata
```

Do not put API keys or integration secrets in Vite environment variables: every `VITE_*` value is included in the browser bundle.

Production uses `VITE_API_URL=https://api.sslping.io`. The dashboard is
published at `https://dashboard.sslping.io`; `https://sslping.io` remains the
marketing site and `https://www.sslping.io` redirects to it. The image is also
built with the public Cloudflare Turnstile site key from the production GitHub
Environment variable `CLOUDFLARE_TURNSTILE_SITE_KEY`; the private Turnstile
secret is never present in this repository or browser bundle.

Production image delivery is defined in
`.github/workflows/deploy-production.yml`. Cluster bootstrap, GitHub secrets,
deployment order and Cloudflare DNS are documented in the backend repository's
`deploy/kubernetes/README.md`.

## Quality checks

```bash
npm run check
npm test
npm run build
npm run preview
```

Public managed status pages load their service marks from the vendored
`public/assets/service-logos/` pack. Its source-of-truth manifest is mirrored
in `data/service-logos.json`; tests require exact 776-file SHA-256 coverage and
inert SVG content. Publish this dashboard/status asset pack before a backend
catalog release that starts referencing new logo paths.

The test suite covers API/session behavior, auth flows, monitor mappings, live dashboard adapters, operations, team/integrations and public status pages. The detailed screen-to-API contract is documented in [`docs/dashboard-functional-map.md`](docs/dashboard-functional-map.md).

## Routes

- `/login`, `/register`, `/forgot-password`, `/reset-password`, `/login/2fa`, `/verify-email`
- `/accept-invite` for authenticated invitation acceptance (with safe login return)
- `/monitors`, `/monitors/:monitorId`, `/monitors/:monitorId/edit`
- `/incidents`, `/status-pages`, `/status-pages/:statusPageId/edit`
- `/maintenance`, `/team`, `/integrations`
- `/support` for customer tickets
- `/admin` for system administrators only
- `/:slug` on `status.sslping.io` for public status pages (`/status/:slug` redirects for compatibility)
- `/demo` for the local product preview

This directory is its own local Git repository and has no GitHub remote configured.

# SSLPing Dashboard

Production-oriented Vite/React dashboard for the SSLPing monitoring platform. It mirrors the workflows from the supplied UptimeRobot references while using SSLPing's own visual language and backend contract.

## Included functionality

- authentication, registration, e-mail verification, password reset and 2FA;
- workspace-aware session lifecycle with access-token refresh;
- HTTP, keyword, TCP, UDP, TLS, DNS, domain, reachability and heartbeat monitors;
- monitor creation, editing, pause/resume, test checks, deletion, response metrics, evidence and incident history;
- incidents, maintenance windows and branded public status pages;
- team invitations and member management;
- Slack, Telegram, webhook and other notification integrations;
- API keys, audit-ready models and responsive public status pages;
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
```

Do not put API keys or integration secrets in Vite environment variables: every `VITE_*` value is included in the browser bundle.

## Quality checks

```bash
npm run check
npm test
npm run build
npm run preview
```

The test suite covers API/session behavior, auth flows, monitor mappings, live dashboard adapters, operations, team/integrations and public status pages. The detailed screen-to-API contract is documented in [`docs/dashboard-functional-map.md`](docs/dashboard-functional-map.md).

## Routes

- `/login`, `/register`, `/forgot-password`, `/login/2fa`, `/verify-email`
- `/monitors`, `/monitors/:monitorId`, `/monitors/:monitorId/edit`
- `/incidents`, `/status-pages`, `/status-pages/:statusPageId/edit`
- `/maintenance`, `/team`, `/integrations`
- `/status/:slug` for public status pages
- `/demo` for the local product preview

This directory is its own local Git repository and has no GitHub remote configured.

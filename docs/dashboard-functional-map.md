# SSLPing Dashboard: функциональная карта

Дата сверки: 2026-07-25
Источники истины: 22 приложенных скриншота UptimeRobot и `backend/docs/openapi.yaml` (OpenAPI 3.1, 89 операций).
Цель документа: зафиксировать функциональный паритет dashboard, не копируя чужие тексты, логотип или другие защищённые бренд-материалы.

## 1. Область и общие правила

Dashboard — authenticated SPA поверх `/v1`. Во всех tenant-запросах `tenant_id` должен совпадать с workspace, записанным в access token; иначе backend намеренно возвращает `404`. Основные сущности: workspace, monitor, check, incident, maintenance window, status page, member, integration и API key.

Обязательные глобальные состояния каждого экрана:

- initial loading: скелетон в геометрии будущего экрана, без скачка layout;
- populated, empty, filtered-empty и paginated/loading-more;
- recoverable error с `Problem.detail`, повтором запроса и `X-Request-ID`;
- `401`: одна попытка `POST /v1/auth/refresh`, затем очистка сессии и redirect на login;
- `403`: read-only экран и явное объяснение недостатка прав, без скрытого вызова запрещённого endpoint;
- `404`: workspace/resource not found, без раскрытия существования чужого tenant;
- `409`: сохранить введённые данные и подсветить конфликт;
- `429`: отключить повтор до окончания `Retry-After`;
- mutations: busy state, защита от двойной отправки, success/error toast, повторная синхронизация server state;
- destructive actions: отдельное подтверждение с именем ресурса;
- время показывать в timezone workspace, в tooltip — исходное UTC/ISO значение;
- URL, токены и webhook secrets никогда не писать в аналитические события, логи браузера или error breadcrumbs.

### 1.1. App shell

Desktop-композиция как на референсе:

- фиксированная левая навигация: Monitoring, Incidents, Status pages, Maintenance, Team members, Integrations & API;
- внизу sidebar: avatar/name, workspace/profile menu, plan CTA и collapse;
- основной контент ограничен читаемой шириной; заголовок слева, page actions справа;
- floating support/help button справа снизу (до подключения поддержки открывает локальную help-панель, а не фиктивный внешний чат);
- активный пункт имеет контрастную подложку и зелёный accent;
- dropdown, modal и drawer закрываются `Escape`, возвращают focus trigger-элементу.

## 2. Маршруты dashboard

Предлагаемый client route | Экран | Основные API
--- | --- | ---
`/login` | Вход | `POST /v1/auth/login`
`/login/2fa` | Завершение 2FA | `POST /v1/auth/login/2fa`
`/register` | Регистрация и первый workspace | `POST /v1/auth/register`
`/verify-email` | Запрос/подтверждение email | `POST /v1/auth/email-verification/request`, `/confirm`
`/forgot-password` | Запрос reset | `POST /v1/auth/password/forgot`
`/reset-password` | Новый пароль по token | `POST /v1/auth/password/reset`
`/invite/accept` | Принятие приглашения | `POST /v1/invitations/accept`
`/app/:tenantId/monitors` | Monitoring list | `GET /monitors`, `GET /metrics/summary`
`/app/:tenantId/monitors/new` | Create monitor | `GET /v1/regions`, `POST /monitors`
`/app/:tenantId/monitors/:monitorId` | Monitor detail | monitor, metrics, checks, evidence, incidents и связанные ресурсы
`/app/:tenantId/monitors/:monitorId/edit` | Edit monitor | `GET`, `PATCH /monitors/{monitor_id}`
`/app/:tenantId/incidents` | Incidents list | `GET /incidents`
`/app/:tenantId/incidents/:incidentId` | Incident detail/timeline | incident, comments и action endpoints
`/app/:tenantId/status-pages` | Status pages list | `GET/POST /status-pages`
`/app/:tenantId/status-pages/new` | Create status page | `POST /status-pages`
`/app/:tenantId/status-pages/:statusPageId/edit` | Status page editor | page/components/announcements/custom-domain endpoints
`/app/:tenantId/maintenance` | Maintenance windows | maintenance CRUD
`/app/:tenantId/team` | Members / team details | members, invitations, tenant endpoints
`/app/:tenantId/integrations` | Каталог и установленные integrations | integration CRUD/test
`/app/:tenantId/api-keys` | API keys | key list/create/revoke
`/app/:tenantId/audit` | Audit log | `GET /audit-logs`
`/app/:tenantId/settings/security` | Пароль и 2FA | protected auth lifecycle endpoints
`/status/:slug` | Public status preview/runtime | public status page/access/subscriber endpoints

Tenant API prefix в таблице сокращён до `/v1/tenants/{tenant_id}`.

## 3. Auth, onboarding и session lifecycle

### 3.1. Регистрация

Поля:

- `name` — 2–120 символов;
- `email` — валидный email, до 320 символов;
- `password` — 12–72 UTF-8 bytes, минимум одна lowercase ASCII, uppercase ASCII и цифра;
- `workspace_name` — optional, до 120 символов;
- `locale` и IANA `timezone`, предзаполненные browser preferences.

После `POST /v1/auth/register`:

- если есть `tokens`, сохранить session и открыть Monitoring;
- если `tokens` отсутствуют, показать verify-email state и повторную отправку;
- development-only `verification_token` разрешено показывать только в dev UI.

### 3.2. Login и workspace

- Первый шаг: email/password; `tenant_id` optional.
- При `two_factor_required=false` сохранить token pair и загрузить `GET /v1/me`.
- При `two_factor_required=true` перейти на `/login/2fa`, держать `challenge_token` только в памяти/session storage, показать countdown `challenge_expires_at`, принять 6-digit TOTP или recovery code.
- Для пользователя с несколькими workspaces сначала можно вызвать login без `tenant_id`, затем показать доступные workspaces из `/v1/me`; текущее API не умеет перевыпустить token для другого tenant без повторного login — см. gaps.

### 3.3. Verify/reset/invite

- Verify email: request всегда показывает одинаковый anti-enumeration success; confirm принимает token в JSON, не мутирует состояние через `GET`.
- Forgot password: одинаковый success независимо от существования аккаунта; reset принимает token + новый пароль.
- Invite accept: authenticated пользователь с совпадающим email отправляет token в `POST /v1/invitations/accept`; expired/used/conflicting invite имеет отдельное состояние.
- Logout отправляет refresh token в `POST /v1/auth/logout`, затем локально очищает оба token.

### 3.4. Security settings

- Change password: current + new password; после успеха считать прежние refresh sessions отозванными и запросить новый login.
- Enable 2FA: подтвердить password → показать secret/QR из `otpauth_url` → подтвердить TOTP → один раз показать и предложить скачать 10 recovery codes.
- Disable 2FA: password + TOTP/recovery code.
- Regenerate recovery codes: password + second factor; старые коды немедленно считать недействительными.

## 4. Monitoring list

Client route: `/app/:tenantId/monitors`.

### 4.1. Layout и данные

Верхняя строка:

- заголовок `Monitors`;
- split-button `+ New` с быстрым выбором monitor type;
- selection counter/checkbox;
- toggle `Show groups`;
- search `Search by name or URL`;
- filter button;
- sort dropdown, default `Down first`.

Таблица/row:

- status icon (`pending`, `up`, `down`, `degraded`, `paused`);
- friendly name, target, type badge, uptime-since/status-since;
- group/tag chips;
- domain and SSL expiry warnings, если есть evidence;
- `View incident` для active failure;
- last check age и configured interval;
- последние check bars и uptime percentage;
- kebab: view, edit, pause/resume, test check, rotate heartbeat token (heartbeat only), delete.

Правая summary column:

- Current status: Down / Up / Paused и usage/quota;
- Last 24 hours: overall uptime, MTBF, time without incidents, incident count.

API mapping:

- `GET /monitors?limit&cursor&search` — базовые rows;
- `GET /metrics/summary?from&to` — summary и per-monitor availability;
- `GET /monitors/{id}/checks?from&to` — bars/last results, если summary недостаточно;
- evidence endpoints — SSL/DNS/domain side data;
- `POST .../actions/pause|resume|test`, `DELETE /monitors/{id}`.

Состояния: full list, group view, active search/filter, no results, no monitors onboarding, partial per-row metric failure, cursor `Load more`, bulk selection. До появления server-side filters клиентские filter/sort допустимы только для уже загруженного набора и должны маркироваться как локальные; нельзя создавать видимость фильтрации всего tenant.

## 5. Create/Edit Monitor

Routes: `/monitors/new?type=...` и `/monitors/:id/edit`. Create вызывает `POST /monitors`; edit загружает `GET /monitors/{id}` и отправляет полную mutable-модель в `PATCH`. Тип после создания immutable.

### 5.1. Общая часть для всех типов

Поле | API | Правило UI
--- | --- | ---
Friendly name | `name` | required, 1–200
Type | `type` | required create; read-only edit
Interval | `interval_seconds` | 30–86400; slider presets 30s, 1m, 5m, 30m, 1h, 12h, 24h
Timeout | `timeout_seconds` | 1–60; всегда меньше/разумно относительно interval
Regions | `regions[]` | options из `GET /v1/regions`, unique, default `local`
Group | `group_name` | free-form string; group entity отсутствует
Tags | `tags[]` | unique chips
Failure retry | `retry_policy.failure_threshold` | 1–10, default 2
Recovery retry | `retry_policy.recovery_threshold` | 1–10, default 1
Confirmation delay | `retry_policy.confirmation_delay_seconds` | >=0, default 15
Slow alert | `slow_threshold_ms` | 0 = disabled
Paused | `paused` | initial pause / current state

Region selector обязан учитывать capability: keyword использует `http`; `heartbeat` не выполняется из region; для UDP backend capability metadata пока отсутствует.

### 5.2. HTTP monitor

`config.http`:

- `url` (`http/https`, query values в ответе redacted);
- `method`: GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS;
- `headers` key/value editor;
- `body` до 1 MiB и `send_json`;
- `follow_redirects`;
- allowed `status_classes` 1..5 и explicit `allowed_status_codes` 100..599;
- auth type `none/basic/bearer`; username/password либо bearer token;
- `ip_family`: auto, IPv4 only, IPv6 only;
- `user_agent`;
- `validate_tls`;
- optional `tls_expiry_warn_days[]` for certificate evidence and expiry notifications;
- optional `domain_expiry_warn_days[]` for RDAP evidence and expiry notifications;
- `max_body_bytes` 1..10 MiB.

Sensitive fields приходят как `********`. Edit form должен трактовать mask как «секрет сохранён», не отправлять его как новый secret и дать явную команду replace/clear.

### 5.3. Keyword monitor

Это HTTP config плюс `config.http.keyword`:

- `value` required;
- `mode`: `present` или `absent`;
- `case_sensitive`;
- все HTTP fields из предыдущего раздела.

Формулировка summary должна меняться: «incident when keyword is missing/present».

### 5.4. TCP monitor

`config.tcp`: host, port 1–65535, optional send payload, optional expected response, `use_tls`, optional TLS `server_name`.

### 5.5. UDP monitor

`config.udp`: host, port 1–65535, optional payload и expected response.

### 5.6. TLS certificate monitor (legacy API compatibility)

`config.tls`: host, port (default 443), optional SNI/server_name и unique `warn_days[]` 0–3650. Dashboard больше не предлагает этот тип при создании: для новых HTTPS HTTP/keyword monitors сертификат настраивается в блоке `SSL certificate & domain checks`. Существующие standalone monitors остаются доступны для просмотра и редактирования.

### 5.7. DNS monitor

`config.dns`: FQDN name, record type A/AAAA/CNAME/MX/TXT/NS/CAA/SRV, expected records list, optional authoritative/custom nameserver, `require_dnssec`.

### 5.8. Domain expiry monitor (legacy API compatibility)

`config.domain`: registered domain и `warn_days[]`. Dashboard больше не предлагает этот тип при создании: для новых HTTP/keyword monitors RDAP и expiry notifications включаются в блоке `SSL certificate & domain checks`. Существующие standalone monitors остаются доступны для просмотра и редактирования.

### 5.9. Reachability monitor

`config.reachability`: public host и TCP port (default 443). В UI не называть ICMP ping: backend проверяет TCP reachability.

### 5.10. Heartbeat / cron monitor

`config.heartbeat`: expected period 30–604800 seconds и grace seconds. После create показать `heartbeat_url` и raw token ровно один раз с copy/download warning. Rotate вызывает `POST /heartbeat-token/rotate` после подтверждения и также показывает новый secret один раз.

### 5.11. Дополнительные блоки из референса

Визуально форма должна иметь секции `Monitor details`, `Integrations & Team`, `Maintenance info`, SSL/domain и Advanced settings. SSL validation, certificate-expiry reminders и domain-expiry reminders сохраняются в `config.http` и выполняются как дополнительные проверки одного HTTP/keyword monitor. Следующие элементы референса пока не имеют полного backend mapping: per-monitor email/SMS/voice/push recipients, notification delay/repeat и meta fields. Их нельзя показывать как работающие controls до расширения API.

## 6. Monitor detail

Route: `/monitors/:monitorId`.

Header:

- back to Monitoring;
- status icon, friendly name, clickable safe target, type explanation, tags;
- actions: Test check, Pause/Resume, Edit, kebab/Delete; label `Test notification` использовать только после появления соответствующего backend action.

Cards и mapping:

- Current status + duration: `Monitor.status` и `last_status_change_at`;
- Last check + interval: `last_check_at`, `interval_seconds`;
- Last 24h bars: checks for last 24h + metrics;
- Domain & SSL: relevant evidence `details`;
- 7/30/365/custom availability, incidents, downtime, MTBF: отдельные `GET /metrics?from&to`;
- response chart: raw `GET /checks?from&to`, с average/min/max, region selection;
- latest incidents: `/incidents`, затем filter/join by `monitor_id` до server filter;
- Regions: monitor `regions` + `/v1/regions` metadata;
- Next maintenance: list windows and compute applicable next occurrence;
- To be notified: integrations whose `monitor_ids` empty or includes monitor;
- Appears on: status pages + component lists.

Detail states: pending/no checks, healthy, degraded, down with active incident, paused, partial evidence unavailable, heartbeat never received, data retention gap.

## 7. Incidents

### 7.1. List

Route: `/incidents`.

Toolbar: search name/URL, tags, started sort, advanced filter, export. Dismissible infrastructure notice (например, checker IP allowlist) допускается только при наличии реального config/source link.

Columns:

- Status;
- Monitor (join `monitor_id` → monitor name);
- Root cause;
- Comments count;
- Started;
- Resolved;
- Duration (live counter для unresolved);
- Visibility;
- row action/open detail.

API: `GET /incidents?limit&cursor&search&from&to`. Backend не предоставляет tag/status/sort/export/comment-count filters; это отмечено в gaps.

### 7.2. Incident detail и actions

Route: `/incidents/:incidentId`.

- `GET /incidents/{id}` возвращает incident + timeline;
- `GET /comments` обновляет timeline;
- Viewer и выше: acknowledge, assign active team member, add comment;
- Editor и выше: resolve;
- comment form 1–10000 символов;
- показывать acknowledgement, assignee, root cause, visibility, duration и timestamps;
- optimistic action допустим только с rollback; server response остаётся canonical.

Состояния: investigating/open, acknowledged, assigned, resolved, already-resolved idempotent display, concurrent update, deleted/not found. Backend enum содержит `identified` и `monitoring`, но публичных переходов в них нет.

## 8. Status pages

### 8.1. List

Route: `/status-pages`.

Таблица: Name + monitor count, Access level, Published/Draft, Add announcement, Open public page, kebab Edit/Delete. Header action `Create Status page`.

API: `GET /status-pages`, `POST /status-pages`, `DELETE /status-pages/{id}`. Для monitor count использовать detail/components. Access level нельзя надёжно определить из admin response при password protection — backend gap.

### 8.2. Create

Минимальный wizard:

1. name и optional slug/homepage;
2. ordered monitor selection;
3. language, visibility/published;
4. optional password (минимум backend требует 12–72 bytes фактически);
5. create → editor/preview.

### 8.3. Editor

Route с tabs/anchor navigation: `Monitors`, `Appearance`, `Global settings`, `Announcements`.

`Monitors`:

- select all/tags/individual monitors;
- drag reorder components;
- `PUT /status-pages/{id}/components` с полным ordered `monitor_ids`.

`Appearance` и Name/homepage:

- name, slug, homepage URL;
- logo, accent/colors/theme и другие визуальные options хранятся в arbitrary `branding` JSON;
- preview открывает public route в новой вкладке.

`White-label / custom domain`:

- claim domain через `PUT /custom-domain`;
- показать exact TXT name/value и expiry;
- verify через `POST /custom-domain/verify`, states pending/verified/expired/conflict;
- typed Google Analytics ID, remove product logo и remove cookie consent отсутствуют в schema как отдельные поля; возможная branding convention должна быть формально согласована перед реализацией.

`Access`:

- password toggle + password input;
- update semantics: `null/omitted` сохраняет пароль, empty string удаляет;
- language: en, zh, hi, es, fr, ar, bn, pt, ru, id;
- robots: `index,follow`, `noindex,nofollow`, `noindex,follow`.

`Features` → `page.settings`:

- show bar charts;
- show uptime percentage;
- show overall percentage;
- show outage details;
- enable details page;
- show monitor URL;
- hide paused monitors;
- enable subscribe;
- show latest downtime/outage updates;
- small cookie dialog;
- share analytics.

Референсный `Enable floating status bar` отсутствует в backend schema.

`Announcements`:

- list via `GET /announcements`;
- modal: title, body, status (investigating/identified/monitoring/resolved), optional incident;
- create immediately via `POST /announcements`;
- при `enable_subscribe` confirmed subscribers получают delivery через outbox.

В `PUT /status-pages/{id}` всегда передавать полный `monitor_ids`: omission текущий handler декодирует как empty и очистит mapping. Для порядка предпочтителен отдельный components endpoint.

### 8.4. Public status runtime

- `GET /public/status-pages/{slug}` или by-domain;
- password state → `POST .../access`;
- компоненты, overall state, announcements, subscribe form;
- subscriber confirm/unsubscribe выполняются POST; GET только безопасно показывает preview/confirmation form;
- respect language, robots, branding, GDPR/cookie settings и RTL для Arabic.

## 9. Maintenance windows

Route: `/maintenance`.

Empty state повторяет референс: onboarding illustration/copy + Create CTA. Populated state: name, affected monitors, next start, duration, timezone, recurrence, active, actions edit/delete.

Create/Edit modal fields:

- name;
- monitor multi-select (минимум один);
- repeat: once/daily/weekly;
- date + start time → `starts_at` ISO;
- timezone IANA (default UTC);
- duration 1–525600 minutes;
- weekdays 0..6 для weekly;
- optional recurrence end `ends_at`;
- active on replacement update.

API: list/create/get/PUT/delete maintenance windows. Search из скриншота пока client-side only и не должен обещать server-wide result.

## 10. Team members и workspace

Route: `/team`, sub-tabs `Team members` и `Team details`.

Members table:

- name/email (`Membership.user`);
- phone;
- role;
- 2FA enabled/not enabled;
- member status;
- edit and remove actions;
- owner/current-user markers.

Invite modal:

- email required;
- role: admin/editor/viewer/notifier;
- optional phone;
- explanatory role copy;
- `POST /invitations`, invitation expires in seven days.

Member edit: role/status PATCH. Delete: non-owner only, with confirm. Team details: workspace name, slug и timezone via GET/PATCH tenant.

Seat usage, `Buy seats`, plan limits и billing CTA из референса не имеют backend endpoints и должны быть скрыты либо явно помечены как unavailable, не выводить фиктивные числа.

## 11. Integrations & API

### 11.1. Каталог

Route: `/integrations`, categories `All`, `Chat platforms`, `Webhooks`, `Connectors & incident management`, `Push notifications`, `API`; search filters catalog and installed instances locally.

Card:

- provider icon/name/description;
- installed rows: friendly name, active state, edit/test/delete;
- `+ Add` opens type-specific modal;
- create/update common fields: `name`, non-empty unique `events[]`, optional `monitor_ids[]`, active state.

Events:

- monitor.down;
- monitor.up;
- monitor.slow;
- ssl.expiry;
- domain.expiry;
- incident.updated;
- maintenance.started.

Config per type:

Type(s) | Поля
--- | ---
webhook, slack, microsoft_teams, discord, google_chat | HTTPS URL, optional headers, signing secret, custom value
telegram | bot token, chat id
pagerduty | routing key
opsgenie | API key, region US/EU
pushover | API token, user key, optional device, priority -2..2
pushbullet | access token
sms, voice | Twilio account SID, auth token, E.164 from/to
email | 1–50 recipient emails

Slack modal повторяет референс: friendly name, webhook URL, custom value, multi-select events, monitor routing. Webhook modal поддерживает URL/custom headers/signing secret/custom value; референсные modes «default variables as query string/POST parameters» и arbitrary POST template backend не поддерживает.

Edit semantics:

- type immutable;
- events — required full replacement;
- omitted `monitor_ids` очищает routing, поэтому UI всегда отправляет текущий полный список;
- omitted config сохраняет encrypted config;
- redacted config не подставлять как новый secret;
- Test: `POST /integrations/{id}/actions/test`, rate limited;
- Delete: confirm, затем `DELETE`.

Android/iOS cards из референса должны быть store download links. Backend не имеет device registration, APNs или FCM push integration.

### 11.2. API keys

Route: `/api-keys`.

- list name, prefix, scopes, optional monitor, last used, expires, revoked;
- create modal: name, scopes, optional expiration, optional monitor-specific mode;
- raw `sp_live_...` secret показать и разрешить copy/download ровно один раз;
- revoke with confirm; revoked key остаётся с state либо исчезает после refetch согласно response list;
- monitor-specific key допускает только explicit `monitors:read`;
- UI presets `Main/write`, `Read-only`, `Monitor read-only` являются presentation presets, не singleton keys.

MCP card из референса backend endpoint не имеет.

### 11.3. Audit

Admin/owner screen: cursor list, search/date range, actor/action/resource/IP/metadata, no secret rendering. API: `GET /audit-logs?limit&cursor&search&from&to`.

## 12. Права ролей

Роль | Чтение tenant | Incident collaboration | Изменение operational resources | Team/workspace/API keys/audit
--- | --- | --- | --- | ---
notifier | нет: tenant middleware блокирует dashboard | нет | нет | нет; роль только для уведомлений
viewer | да | acknowledge, assign, comment | нет | members read only
editor | да | viewer + resolve | monitors, maintenance, status pages, announcements, integrations | members read only
admin | всё editor | да | да | update workspace, invite/edit/remove members, API keys, audit
owner | всё admin | да | да | всё admin; owner нельзя понизить/удалить обычным member action

UI не должен полагаться только на hidden controls: backend остаётся authority. API-key access дополнительно ограничен scopes: `read/write`, `monitors:read/write`, `incidents:read/write`, `status:read`; monitor-bound key видит только один monitor.

## 13. Responsive behavior

### >= 1280 px

- fixed sidebar 320–360 px визуально как в референсе;
- content + optional right summary rail;
- wide tables без обрезания primary fields;
- modal max width по форме, scroll внутри viewport.

### 768–1279 px

- sidebar collapsed to icon rail или temporary drawer;
- right summary rail переносится над таблицей в 2-column cards;
- filter controls сворачиваются в toolbar/menu;
- editor right anchor navigation становится sticky horizontal tabs.

### < 768 px

- top app bar с menu, workspace switcher и primary action;
- tables становятся semantic cards, важные поля сверху, secondary data в disclosure;
- filters открываются bottom sheet, sort — отдельный select;
- modal становится full-screen sheet; footer actions sticky и учитывают safe-area;
- Monitor detail cards — одна колонка; charts горизонтально не ломают viewport и имеют accessible summary;
- status editor, monitor editor и maintenance form — одна колонка;
- touch targets минимум 44×44 px, no hover-only actions.

Для RTL (Arabic) sidebar/drawer, chevrons, table alignment и charts должны зеркалиться логически, но time-series остаётся слева-направо.

## 14. Критичные расхождения screenshots ↔ backend

Приоритет | Расхождение | Влияние / временный путь
--- | --- | ---
P0 | Monitoring list API не отдаёт row aggregate: last bars, active incident, SSL/domain expiry, status-since и quota; нет status/tag/group/sort filters | Нужен aggregation endpoint; fan-out по каждому monitor годится только для demo и не масштабируется
P0 | Нет time-series aggregation endpoint | Chart можно построить из raw checks, но retention/downsampling/pagination дадут неполный график
P0 | Screenshot action `Test notification`, backend `actions/test` выполняет сам monitor check | Переименовать UI в `Test check`; для полного parity нужен notification action
P0 | Per-monitor recipients, channels, notification delay/repeat отсутствуют | Частично заменить integration `monitor_ids`; персональные email/SMS/voice/push rules требуют backend model
P0 | Admin `StatusPage` не сообщает `password_protected` | Editor не может корректно показать исходное состояние password toggle; нужно добавить boolean
P0 | Multi-workspace token нельзя переключить без повторного login с `tenant_id` | Нужен switch-workspace/token endpoint либо явный повторный login flow
P1 | Incident list не имеет status/tag/root-cause/visibility/sort filters, comments count и export | Локальная фильтрация неполна; нужен server-side query/export
P1 | Incident actions не позволяют transitions в identified/monitoring, reopen или изменить visibility | Detail action bar будет уже референса
P1 | Status page lacks floating status bar setting; GA/remove-logo/remove-cookie-consent не typed; public snapshot только uptime_24h | Часть controls скрыть; branding convention и richer public metrics требуют API contract
P1 | Announcement только immediate create/list; нет edit/delete/schedule и subscriber management | Announcements screen функционально ограничен
P1 | Generic webhook не поддерживает query-string/POST-parameter modes и custom POST template из screenshots | Показать только фактические URL/headers/signing/custom-value fields
P1 | Нет APNs/FCM device registration и MCP endpoint | Android/iOS — только ссылки на stores; MCP card скрыт/disabled
P1 | Нет billing/plan quota/seats endpoints | Не показывать фиктивные `78/100`, seat count или Buy seats
P1 | Invitations нельзя list/resend/revoke; user profile/phone нельзя редактировать | Team lifecycle неполный
P2 | Maintenance list без search/filter/next-occurrence endpoint | Small list фильтровать локально; occurrence считать клиентом по тем же recurrence rules
P2 | Monitor groups — только строка, нет CRUD/order; monitor list filter только search | Group toggle требует client grouping и не покрывает весь cursor dataset
P2 | HTTP/keyword monitor не имеет meta fields | Meta fields скрыть до расширения API
P2 | Regions capability metadata не включает UDP/keyword/heartbeat напрямую | keyword map → http; heartbeat no region; UDP только supported/default region до уточнения
P2 | Status-page access level не виден в list response; monitor association reverse lookup отсутствует | Требуются detail fan-outs; лучше добавить summary fields/query by monitor
P2 | API keys нельзя update/rotate, только create/revoke | Rotation UI = create replacement, reveal once, revoke old

## 15. Acceptance checklist

### Foundation/auth

- [ ] Direct navigation сохраняет target и после login возвращает на него.
- [ ] Refresh выполняется один раз для пачки concurrent `401`, без refresh storm.
- [ ] Register, email verify, forgot/reset, invite accept, 2FA login/setup/disable/recovery flows покрыты integration tests.
- [ ] Tokens/secrets не попадают в URL, console, telemetry и snapshots.
- [ ] Tenant isolation и role matrix имеют route/UI tests для notifier/viewer/editor/admin/owner.

### App shell/responsive/accessibility

- [ ] Navigation и page hierarchy совпадают с reference на desktop.
- [ ] 1440/1024/768/390/320 px проходят visual regression без horizontal page overflow.
- [ ] Keyboard-only: sidebar, dropdowns, tables/cards, dialogs и forms полностью доступны.
- [ ] Focus trap/restore, ARIA names, status live regions и contrast проходят automated a11y checks.
- [ ] 10 locales поддержаны; Arabic RTL проверен отдельно.

### Monitors

- [ ] List имеет loading/empty/populated/filtered/error/cursor states, status summary и row actions.
- [ ] Create/Edit покрывает все девять monitor types и каждое поле OpenAPI schema.
- [ ] Secret masks не перезаписывают реальные credentials.
- [ ] Pause/resume/test/delete/heartbeat rotate подтверждаются server response.
- [ ] Detail показывает корректные 24h/7d/30d/365d/custom metrics, checks, incidents и evidence либо честный unavailable state.

### Incidents

- [ ] Table вычисляет duration и разрешает открыть detail без потери filters/scroll.
- [ ] Ack/assign/comment доступны viewer+, resolve editor+.
- [ ] Concurrent/stale responses не оставляют ложный optimistic state.
- [ ] Неподдерживаемые export/status transitions не изображены рабочими.

### Status pages

- [ ] Create/list/edit/delete/preview работают; monitor order сохраняется.
- [ ] Update не очищает monitors/password случайным omission.
- [ ] Custom-domain TXT claim/verify показывает pending, expired, conflict и verified.
- [ ] Public password, subscribe, POST confirm/unsubscribe и GDPR settings протестированы.
- [ ] Announcement создаётся один раз и после refetch виден admin/public view.

### Maintenance/team/integrations/API

- [ ] Maintenance once/daily/weekly и timezone дают одинаковую next occurrence с backend semantics.
- [ ] Invite/edit/disable/remove соблюдают admin/owner ограничения.
- [ ] Каждая из 13 integration types имеет корректную type-specific validation, redaction-safe edit, test и delete.
- [ ] API key secret отображается один раз; preset scopes и monitor-bound restriction валидны.
- [ ] Audit screen никогда не визуализирует credential-like metadata без redaction.

### Release gate

- [ ] Typecheck, lint, unit, API integration, accessibility и visual regression suites green.
- [ ] Production build не содержит demo fixtures и не обращается к mock API.
- [ ] Все visible controls либо вызывают реальный backend endpoint, либо явно disabled с причиной.
- [ ] Нет N+1/fan-out архитектуры в monitor/status page lists на production volumes; до появления aggregation endpoints такие widgets feature-flagged.

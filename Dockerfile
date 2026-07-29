# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
ARG VITE_API_URL=https://api.sslping.io
ARG VITE_DEMO_MODE=false
ARG VITE_TURNSTILE_SITE_KEY
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_DEMO_MODE=${VITE_DEMO_MODE}
ENV VITE_TURNSTILE_SITE_KEY=${VITE_TURNSTILE_SITE_KEY}
RUN test -n "${VITE_TURNSTILE_SITE_KEY}" && npm run build

FROM nginxinc/nginx-unprivileged:1.30.4-alpine
COPY --chown=101:101 deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --chown=101:101 deploy/nginx/security-headers.inc /etc/nginx/conf.d/security-headers.inc
COPY --from=build --chown=101:101 /app/dist /usr/share/nginx/html
USER 101:101
EXPOSE 8080

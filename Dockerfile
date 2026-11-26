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

FROM nginx/nginx-unprivileged:1.31.10-alpine@sha256:86628f2c9eaa5e84e3b98d25e26563c4a4f9b0ead9cf5656da4731d86e0621de
COPY --chown=101:101 deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --chown=101:101 deploy/nginx/security-headers.inc /etc/nginx/conf.d/security-headers.inc
COPY --from=build --chown=101:101 /app/dist /usr/share/nginx/html
USER 101:101
EXPOSE 8080

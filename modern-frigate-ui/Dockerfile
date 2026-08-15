ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.20
# ---------- build stage ----------
FROM node:22-alpine AS build
WORKDIR /build
COPY app/frontend/package.json app/frontend/
COPY app/backend/package.json app/backend/
RUN cd app/frontend && npm install --no-audit --no-fund \
 && cd ../backend && npm install --no-audit --no-fund
COPY app/ app/
RUN cd app/frontend && npm run build \
 && cd ../backend && npm run build \
 && npm prune --omit=dev

# ---------- runtime stage ----------
FROM ${BUILD_FROM}
ENV NODE_ENV=production
RUN apk add --no-cache nodejs
WORKDIR /opt/app
COPY --from=build /build/app/backend/dist ./dist
COPY --from=build /build/app/backend/node_modules ./node_modules
COPY --from=build /build/app/backend/package.json ./package.json
COPY --from=build /build/app/frontend/dist ./public
COPY run.sh /run.sh
RUN chmod a+x /run.sh
CMD [ "/run.sh" ]

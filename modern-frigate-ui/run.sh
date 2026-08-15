#!/usr/bin/with-contenv bashio
set -e

export FRIGATE_URL="$(bashio::config 'frigate_url')"
export LOG_LEVEL="$(bashio::config 'log_level')"
export PREVIEW_REFRESH_SECONDS="$(bashio::config 'preview_refresh_seconds')"
export PORT=8099
export STATIC_DIR=/opt/app/public
export DATA_DIR=/data

bashio::log.info "Starting Modern Frigate UI on port ${PORT}"
exec node /opt/app/dist/server.js

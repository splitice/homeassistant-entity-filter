ARG BUILD_ARCH
ARG BUILD_VERSION
FROM ghcr.io/home-assistant/base:latest

LABEL \
  io.hass.name="Home Assistant Entity Filter" \
  io.hass.description="Transparent Home Assistant proxy with entity filtering and rate limiting" \
  io.hass.arch="${BUILD_ARCH}" \
  io.hass.type="app" \
  io.hass.version="${BUILD_VERSION}"

RUN apk add --no-cache nodejs npm

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src
COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD ["/run.sh"]

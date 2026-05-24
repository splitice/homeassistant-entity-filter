# Splitice Home Assistant Apps

This repository contains a Home Assistant app repository for the Home Assistant Entity Filter.

## Included app

- `Home Assistant Entity Filter`

The app runs a transparent proxy in front of Home Assistant and can:

- allow or deny entities by exact match or regular expression
- apply per-entity rate limits with trailing flush semantics
- proxy all non-WebSocket traffic through unchanged
- analyze configured dashboards to derive required entities

## Installation

1. In Home Assistant, open the app store.
2. Add this GitHub repository as a custom repository:
   - `https://github.com/splitice/homeassistant-entity-filter`
3. Install `Home Assistant Entity Filter`.
4. Start the app.
5. Open the proxy at `http://<ha-host>:10111/`.

The app proxies the local Home Assistant instance internally. No external Home Assistant URL or external bootstrap token is required in app mode.

## Configuration

See `homeassistant-entity-filter/DOCS.md` for the full app configuration reference.

## Developer note

The runnable Node project now lives under `homeassistant-entity-filter/`.

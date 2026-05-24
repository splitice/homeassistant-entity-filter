# Home Assistant Entity Filter

## What it does

This app runs a transparent proxy in front of Home Assistant.

It can:

- filter entities in or out by exact match or regular expression
- rate limit specific entities while still delivering the latest value when the rate window reopens
- emit a rolling 5-minute summary log for forwarded updates, filter drops, and rate-limit coalescing drops
- proxy non-WebSocket traffic through unchanged
- analyze configured dashboards and include their required entities automatically

## Authentication model

Client authentication is passed through unchanged.

The browser still authenticates against Home Assistant as normal through `/api/websocket` and the regular HTTP auth flow.

For dashboard bootstrap and entity analysis, the app uses Home Assistant's internal Supervisor websocket proxy with `SUPERVISOR_TOKEN`. This is internal to Home Assistant app mode and does not require the user to configure an external token.

## Network endpoint

- Default proxy port: `10111`
- Container bind: `0.0.0.0:10111`
- Host access: `http://<ha-host>:10111/`

The app also exposes an Open Web UI button that targets the proxy.

## Dashboard names

When specifying dashboards, use the Lovelace `url_path`, for example:

- `dashboard-kiosk`
- `wallpanel`
- `default`

Do not include the trailing view index such as `/0`.

## Configuration reference

### `transparent`

When `true`, the proxy strips forwarded headers before sending traffic upstream.

### `bootstrap_timeout_ms`

Timeout for bootstrap websocket calls used to fetch dashboard configuration and entity catalogs.

### `bootstrap_cache_ttl_ms`

Cache lifetime for bootstrap data.

### `warn_entity_updates_over_per_minute`

Warn to console if an allowed entity exceeds this average update rate over a trailing 3 minute window. Set to `0` to disable warnings.

### `default_action`

Default action for entities that do not match any explicit rule.

Valid values:

- `allow`
- `deny`

### `required_entities`

Entities that should always be treated as required unless an explicit rule overrides them.

### `dashboards`

Dashboard `url_path` values whose referenced entities should be added to the required set.

### `rules`

Ordered list of filtering and rate-limit rules.

Each rule supports:

- `name`
- `match_type`: `exact` or `regex`
- `match`
- `action`: `allow` or `deny`
- `rate_limit_ms` for allow rules

## Example rules

```yaml
rules:
  - name: "deny cameras"
    match_type: regex
    match: "^camera\\."
    action: deny

  - name: "throttle kiosk smart plug power"
    match_type: exact
    match: "sensor.ikea_of_sweden_inspelning_smart_plug_power"
    action: allow
    rate_limit_ms: 30000
```

## Dashboard extraction rules

`dashboard_extraction_rules` controls additional dashboard bootstrap extraction behavior. These rules are separate from websocket filter `rules`.

Built-in structural extraction already walks nested cards, custom card payloads, `visibility`, `conditions`, and action payloads. The built-in `custom:mushroom-template-badge` template parser is also enabled by default for `content`, `icon`, and `color`.

In this pass, custom extraction rules support only `template_entities` mode:

```yaml
dashboard_extraction_rules:
  - card_type: "custom:mushroom-template-badge"
    mode: "template_entities"
    fields:
      - content
      - icon
      - color
```

## Standalone developer mode

This repository is packaged primarily as a Home Assistant app repository, but the Node project can still be run directly by developers from `homeassistant-entity-filter/` using `proxy-config.yaml`.

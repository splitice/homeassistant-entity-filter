# Repository instructions

## Layout

- The repo root is a Home Assistant app repository.
- The runnable daemon project lives in `homeassistant-entity-filter/`.
- Run Node commands from `homeassistant-entity-filter/` unless you are working on repository metadata.

## Home Assistant repository rules

- Do not create another file named `config.yaml` anywhere outside `homeassistant-entity-filter/config.yaml`.
- Home Assistant Supervisor recursively scans repositories for `config.yaml`.

## Change coordination

- If you change add-on options or schema, also update:
  - `homeassistant-entity-filter/DOCS.md`
  - `homeassistant-entity-filter/README.md`
  - `homeassistant-entity-filter/translations/en.yaml`
  - `homeassistant-entity-filter/src/addonMain.js`
- If you change port behavior, also update:
  - `homeassistant-entity-filter/config.yaml`
  - `homeassistant-entity-filter/src/config.js`
  - startup log tests
  - docs
- If you change bootstrap auth behavior, keep standalone mode and add-on mode working.
- If you change startup log formatting, preserve the `BOUND_*` machine-readable contract.
- Keep downstream client authentication separate from internal bootstrap side-channel authentication.

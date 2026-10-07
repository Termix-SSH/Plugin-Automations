# Contributing to Automations

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
npm run validate   # check manifest.json
npm run format     # format the code with Prettier
```

## Permissions

- `automations.view`: see automations and their runs. Admins and users have it by default.
- `automations.create`: create automations. Admins and users have it by default.
- `automations.edit`: change automations. Admins and users have it by default.
- `automations.delete`: delete automations. Admins and users have it by default.
- `automations.run`: run automations by hand. Admins and users have it by default.

## Services

Provides to other plugins:

- `automations.access`: list and run automations

Uses from other plugins:

- `snippets.access` for the run snippet step. Required
- `fleets.access`, `tunnels.access`, `docker.containers`, `docker.events`, `host-metrics.viewers` and `wake-on-lan.send` for their steps and triggers. Each one is optional

---
name: op-env-creds
description: >-
  Set up and manage per-project .env secrets sourced from 1Password via a
  Makefile + op inject. Use when a user wants to pull credentials from
  1Password into a project's .env, bootstrap a headless 1Password service
  token, add `make creds`/`make setup`/`make dev` targets, or wire a new repo
  into their 1Password-backed env workflow. Trigger on mentions of 1Password,
  op inject, .env.tpl, service accounts/tokens, or "pull creds".
---

# 1Password-backed project credentials

Render a project's `.env` from secrets stored in 1Password, using a committed
template of `op://` references and a per-project service token so the pull runs
headless (no fingerprint prompt) after a one-time bootstrap.

## Mental model

Three files, clear ownership:

| File | Committed? | Purpose |
|------|-----------|---------|
| `.env.tpl` | yes | Template with `op://<vault>/.env/KEY` refs + non-secret local values |
| `.op.env` | no (gitignored) | Holds `OP_SERVICE_ACCOUNT_TOKEN`; auto-created on first `make creds` |
| `.env` | no (gitignored) | Rendered secrets the app actually loads |

Flow: `make creds` bootstraps `.op.env` (one fingerprint prompt reads the token
from 1Password), then loads it and runs `op inject` on `.env.tpl` → `.env`.
Every run after that is headless because the service token is already on disk.

The service token is per-project: it lives in the same vault as the project's
secrets, at `op://<vault>/op_service_token/credential`, and is scoped to read
only that project's vault(s).

## Setting up a new project

Copy this checklist and work through it:

```
- [ ] 1. Ask the user which 1Password vault holds this project's secrets
- [ ] 2. Confirm `op` CLI is installed and signed in
- [ ] 3. Build .env.tpl from the project's existing .env / .env.example
- [ ] 4. Store the project's secrets as a `.env` item in the vault
- [ ] 5. Create the service token + store it as `op_service_token` in the vault
- [ ] 6. Write the Makefile targets and .gitignore entries
- [ ] 7. Run `make creds` to verify (first run prompts for fingerprint)
```

### 1. Ask for the vault

Always ask the user explicitly — do not guess. Example: "Which 1Password vault
holds this project's secrets? (e.g. `webapp_dev`)". Everything downstream keys
off this `VAULT` value.

### 2. Check the CLI

```bash
op --version && op whoami
```

If `op whoami` fails, tell the user to run `op signin` (or enable Settings →
Developer → Integrate with 1Password CLI + Touch ID) before continuing.

### 3. Build `.env.tpl`

Read the project's current `.env` / `.env.example`. For each var, decide:

- **Secret** (tokens, keys, passwords, prod URLs) → reference:
  `KEY=op://<vault>/.env/KEY`
- **Non-secret local value** (ports, localhost URLs, `NODE_ENV`) → keep the
  literal value so the file is self-documenting and works offline.

Shared/global creds that live in a different vault use that vault's ref
directly, e.g. `CLICKHOUSE_TOKEN=op://shared.vault/<item-id>/password`. If an
item title contains characters invalid in a secret reference (spaces, `(`, `—`),
reference it by its item **ID** instead of its title.

Use `__VAULT__` as a placeholder so the Makefile can retarget dev/prod:

```dotenv
# Rendered to .env by `make creds` (op inject). Refs are safe to commit.
NODE_ENV=development
PORT=3000
DATABASE_URL=op://__VAULT__/.env/DATABASE_URL
SESSION_SECRET=op://__VAULT__/.env/SESSION_SECRET
# ...one line per secret
```

### 4. Store secrets as a `.env` item

Create a single item named `.env` in the vault, one field per secret. Build the
`op item create` call from the existing env file (fields as `KEY[password]=...`):

```bash
op item create --category="Secure Note" --title=".env" --vault="<vault>" \
  "SESSION_SECRET[password]=..." "DATABASE_URL[password]=..." # ...
```

Tip: generate the field args programmatically from the existing `.env` rather
than hand-typing. Verify with `op read "op://<vault>/.env/SESSION_SECRET"`.

### 5. Service token

Have the user create a 1Password **service account** scoped with read access to
this project's vault, then store its token in the same vault so the bootstrap
can fetch it:

```bash
op item create --category=Login --title=op_service_token --vault=<vault> \
  "credential[password]=ops_THE_TOKEN"
```

`op_service_token/credential` is the ref the Makefile reads on first run.

### 6. Write the Makefile

Use this template. Replace `<vault>` with the user's vault and adjust the app
symlink section (or delete it if the app loads root `.env` directly).

```make
.DEFAULT_GOAL := help
VAULT ?= <vault>
OP_TOKEN_REF ?= op://$(VAULT)/op_service_token/credential

help:  ## show available targets
	@grep -E '^[a-zA-Z0-9_.-]+:.*##' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*## "}; {printf "\033[36m%-16s\033[0m %s\n", $$1, $$2}'

.op.env:
	@echo "Bootstrapping service token from 1Password (may prompt for fingerprint)…"; \
	token=$$(op read "$(OP_TOKEN_REF)" 2>/dev/null) || { echo "error: could not read $(OP_TOKEN_REF) — is op signed in and the item present?" >&2; exit 1; }; \
	printf 'OP_SERVICE_ACCOUNT_TOKEN=%s\n' "$$token" > .op.env; \
	echo ".op.env created (future runs won't prompt)"

creds: .op.env  ## render .env from 1Password
	@set -e; \
	set -a; . ./.op.env; set +a; \
	sed 's/__VAULT__/$(VAULT)/g' .env.tpl | op inject -f -o .env; \
	echo ".env rendered from 1Password (vault $(VAULT))"

setup: creds  ## pull creds + install deps
	npm install

dev:  ## start the dev server
	npm run dev

.PHONY: help creds setup dev
```

If the app lives in a subdirectory and expects its own `.env`, symlink it inside
`creds` so there's a single source of truth:

```make
	app=path/to/app; \
	[ -L "$$app/.env" ] && rm "$$app/.env"; \
	[ -f "$$app/.env" ] && mv "$$app/.env" "$$app/.env.bak.$$(date +%Y%m%d%H%M%S)"; \
	ln -sf "$$(pwd)/.env" "$$app/.env"; \
```

### 7. gitignore + verify

Ensure both generated files are ignored:

```gitignore
.env
.op.env
```

Then run `make creds`. First run prompts for fingerprint (to read the token),
writes `.op.env`, and renders `.env`. Confirm `.env` has real values, not
`op://` refs.

## Dev/prod targeting

Because vaults are per-env, switch with a var override — no template changes:

```bash
make creds                    # default VAULT (dev)
VAULT=webapp_prod make creds  # prod vault
```

## Troubleshooting

- **`op inject` prompts every run** → `.op.env` missing or empty. Check the
  token item exists at `OP_TOKEN_REF` and re-run; `rm .op.env && make creds` to
  refresh.
- **`invalid secret reference` from `op inject`** → a `#` comment or an item
  title with invalid characters (spaces, `(`, `—`) leaked into a ref. Reference
  such items by item ID, and keep only `KEY=op://...` lines as refs.
- **`isn't a field`** → the `.env` item is missing that key; add the field in
  1Password or drop the line from `.env.tpl`.
- **Read-only filesystem on symlink** → use `$$(pwd)` for the link target, not
  an absolute `$(CURDIR)` that may resolve oddly in sub-makes.

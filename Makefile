.PHONY: idp-setup idp

# One-time (or after a pull) setup for the idp app: install workspace deps,
# generate Cloudflare worker types, and apply local D1 migrations.
idp-setup:
	npm install
	npm run cf-typegen --workspace=idp
	npm run db:migrate --workspace=idp

# Run the idp app in development.
idp:
	npm run dev --workspace=idp

# Security

## Reporting a problem

If you find a vulnerability, or a secret (API key, token, password) that has been committed to this repository, please report it privately through GitHub: **Security** tab, then **Report a vulnerability**. Please do not open a public issue for it.

If a real secret was ever exposed, treat it as compromised: the owner must **revoke and rotate it at the provider**. Deleting it from the repository is not enough, because git history and forks keep copies.

## For contributors

- Never commit `.env` files, API keys, tokens, passwords, private keys or database URLs with credentials. The only environment file in the repository is `app/.env.example`, which has no values.
- Run the app with your own `app/.env.local`.
- Do not commit raw or processed sales data (see `docs/DATA_COLLECTION.md`). The `.gitignore` excludes `raw-data/` and `app/data/open-data/`.
- Test data must be synthetic. Phone numbers in tests are fake.

## What the app protects

The web app's own security notes (same-origin checks, content security policy, session cookies, rate limits and the admin login) are in `app/README.md`.

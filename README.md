# Dollar.coop institutional design candidate

GitHub Pages serves only `dist/` and deploys changes to `main`. The branch is for review. The public site contains informational copy, the dated regulatory register, a settlement illustration and trust disclosures.

## Verify locally

Use Node 24 or newer.

```sh
node preview/server.mjs
node --test sandbox/ledger.test.mjs preview/server.test.mjs
node sandbox/demo.mjs
npm ci --prefix sandbox
node sandbox/testnet.mjs
```

Open `http://127.0.0.1:4176/` for the site and `http://127.0.0.1:4176/enquiry-preview/` for the enquiry. Use fictitious data. The preview can take an optional SQLite filename for durable sample storage. It binds to loopback and checks the host and origin. Its queue is readable only through the local database or the test harness. The local rate limit resets on restart and is scoped to a single process. The sample expiry sweep runs on startup and once per minute. Sample persistence must be kept in an access-restricted directory.

The Testnet script uses the public XRP Ledger Testnet only. It verifies network ID 1 before requesting faucet funding and generates new keys in memory. Test XRP funds account reserves and fees. A disposable issuer uses an authorised trust-line asset. The script pins issuer and currency, waits for validated results and checks actual delivered amounts and closing holdings. It never sends a second transaction to replace an unresolved one. The separate SQLite model simulates funding, approvals, holds, payout and reconciliation. Its fixture evidence is synthetic and its role strings are test fixtures.

## Release checklist

- Confirm the operator, legal and compliance approvers, publishing approval and controlled deployment identity. Confirm permission before publishing ICBA programme copy or branding. The public revision omits those materials.
- Refresh the primary-source regulatory register before release. Record approver, checked and effective dates, affected entities and next review in the private compliance register.
- On the serving edge, scope the response header change to the exact `dollar.coop` host and validate the existing rules first. Use the staged CSP as the starting point and add `frame-ancestors 'none'` via an HTTP header, plus `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`. Confirm HTTPS and the chosen HSTS scope before enabling HSTS. GitHub Pages does not apply local preview headers. Check both hostnames, apex redirects, assets and CSP in a browser after rollout.
- Keep enquiry intake separate until the operator approves its contact and privacy details, authenticated review queue, logging/retention, spam controls and production support. Exercise those controls with sample data before enabling the form publicly.
- Save the last known-good site SHA and export the relevant edge settings. Revert the merge and redeploy Pages to restore site content if required. Revert only the corresponding edge rule independently if header validation fails. Confirm both hostnames after rollback.
- Keep the funded pilot decision separate from site publication and sandbox results.

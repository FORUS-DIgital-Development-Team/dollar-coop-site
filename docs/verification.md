# Verification record

## 6 November 2026

- Local Edge browser verification exercised the home, settlement, trust and enquiry pages at widths of 320, 390 and 1440 pixels. No horizontal overflow or automated axe WCAG A/AA violations were reported in those checks. The keyboard skip link focused the main region at all three widths. A browser submission reached the local queue and displayed its reference.
- The three Node tests passed. They cover enqueueing and expiry, malformed and unsolicited submissions, browser response headers, replay, inadequate available inventory, incorrect issuer and delivered amount, final failure, unsettled reservations surviving a restart, and a failed payout that remains payable.
- npm audit reported zero known vulnerabilities for the locked Testnet dependencies on the checked date.
- Public XRPL Testnet reported network ID 1. The test asset was TST issued by `rB4GJ1ZmciNndtJ3W13Soy59ie2Nf8ke9`. Each payment was validated and matched the expected delivered asset and amount. Closing holdings were 750,000, 0 and 50,000 TST. The fiat payout and issuer payable were exercised in the local simulation.

| Testnet step | Delivered TST | Validated ledger | Transaction |
| --- | ---: | ---: | --- |
| Issue | 1,000,000 | 22108907 | `E16915948574642B56FDBFF0C90860A50642F101394B8F6130D2CBCAF69F84C5` |
| Transfer | 250,000 | 22108910 | `A5C5A2AF97C9E6C886A765A0122771BDEC1481285C50DD94BEC5191E5298B7CE` |
| Reuse | 50,000 | 22108913 | `362472A9107D05592B8153E0FF264A62090C527EC45B424D90A15B0021B41B5F` |
| Return to issuer | 200,000 | 22108915 | `53DAA15D5A5A6C129C48AFEAF9A52A718F54F099FFCF9B35B57FFD7211099D44` |

The accessibility checks cover the staged pages and automated rules. A full manual WCAG assessment, external security review and production edge verification remain release checks. GitHub Pages currently serves the previous informational version. Its custom domain setting and Cloudflare configuration were inspected only through read-only repository, DNS and HTTP checks.

## Source and release references

Baseline for rollback is Git commit `c65c84cc1d75506dcd1381c83afccb48e35d4384` on `main`. GitHub Pages reports `dollar.forus.digital` as its configured custom domain. The apex responds through Cloudflare with GitHub Pages headers. The live apex response checked on 6 November did not contain CSP, HSTS, MIME or referrer headers. The release review needs the exact current Cloudflare zone and the owner of the approved header rule.

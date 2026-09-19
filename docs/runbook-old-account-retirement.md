# Runbook — old AWS account (942679464475) retirement

Everything still load-bearing on the old account is the **production edge**:
CloudFront `E34Z9POGIQYOCS` (frontend + /api//socket.io//health//uploads
proxy to the backend) and the S3 bucket `aura-frontend-942679464475-ap-south-1`
that feeds it. All 7 storefront lanes hardcode
`https://dbtrhsolhec1s.cloudfront.net` as the edge. Retirement = replicate
the edge in the new account (517353742644), flip the variables, then drain.

**Groundwork completed 2026-09-19 (read-only against old account, additive
in the new account):**
- Full `E34Z9POGIQYOCS` distribution config exported → committed as
  `infra/aws/cloudfront-edge-replica.json` (the replication source of truth).
- OAC `E1IPOYOIPU8DVP` created in the new account (sigv4/always, S3 origin
  type) — the equivalent of old-account OAC `E88GSUA02J7JC`.
- New-account CloudFront creation is **blocked by AWS account verification**
  (`Your account must be verified before you can add new CloudFront
  resources`) — only AWS Support can clear this. Until then the replica
  config cannot be applied.

## Flip checklist (in order, one watched session)

1. **AWS Support verification** of account 517353742644 for CloudFront
   (console → Support → include the AccessDenied error text).
2. **Create the distribution**:
   `aws cloudfront create-distribution --profile aura-new-admin
   --distribution-config file://infra/aws/cloudfront-edge-replica.json`
   (origins already point at `aura-frontend-517353742644-ap-south-1` + the
   backend `13.127.230.58.sslip.io`; 7 ordered cache behaviors + default;
   managed policies `4135ea2d…` = CachingDisabled and `658327ea…` =
   CachingOptimized are global IDs and work as-is).
3. **Bucket policy**: the new bucket currently carries a pre-existing
   `PublicReadStaticWebsite` (Principal `*`) policy — replace it with the
   OAC statement
   (`Principal cloudfront.amazonaws.com`, `s3:GetObject`, condition
   `AWS:SourceArn` = the new distribution ARN).
4. **Seed content**: one-time
   `aws s3 sync s3://aura-frontend-942679464475-ap-south-1 <local>`
   then `aws s3 sync <local> s3://aura-frontend-517353742644-ap-south-1`
   (two profiles; the old-account `aura-admin-cli` user has S3 read but the
   CLI has no cross-account copy flag). Every later release re-seeds via the
   deploy lane once the variables below are set.
5. **Verify the new edge** before anything references it: `https://<new-domain>/`
   bytes-identical to `https://dbtrhsolhec1s.cloudfront.net/`, `/health/live`
   200, `/api/products?limit=1` 200 JSON, socket.io handshake.
6. **Flip the variables** (GitHub repo variables): `AURA_BACKEND_ORIGIN`,
   `AWS_BACKEND_BASE_URL`, `AURA_CLOUDFRONT_DISTRIBUTION_ID` → new values;
   add `AWS_FRONTEND_BUCKET` + `AWS_FRONTEND_DISTRIBUTION_ID` (currently
   **absent** — the AWS storefront deploy lane fails validation without
   them, so today the AWS-hosted storefront is frozen on old-infra bytes
   from 2026-09-17).
7. **Flip the code pin**: `app/config/vercelRoutingContract.mjs`
   `DEFAULT_HOSTED_BACKEND_ORIGIN` (+ the test that pins it), then
   `npm run vercel:routing:sync` to regenerate the 8 host-config files
   (CI now enforces the regen), update `app/capacitor.config.ts`
   allowNavigation and the meta CSP. Ship as one PR.
8. **Deploy** backend (base.env CORS already derives from
   `corsFlags.js` hosted origins + env) and all storefronts via the
   command center.
9. **Drain**: after 2 clean weeks, disable (then delete) `E34Z9POGIQYOCS`,
   empty + delete `aura-frontend-942679464475-ap-south-1`, delete OAC
   `E88GSUA02J7JC`, and delete the old staging distribution
   `E1SZSF4W3BBBZQ` (disabled 2026-09-19, was pointing at the dead staging
   IP `43-205-214-241.sslip.io`; re-enable = flip Enabled back if staging
   ever returns).

## Done as groundwork (2026-09-19)

- [x] Edge config exported + committed (`infra/aws/cloudfront-edge-replica.json`)
- [x] New-account OAC `E1IPOYOIPU8DVP`
- [x] Staging distro `E1SZSF4W3BBBZQ` **disabled** (dead origin; reversible)
- [x] Verified: new-account bucket empty (needs seeding), deploy-lane
      variables missing, old bucket content last modified 2026-09-17
- [ ] AWS account verification (Support — human)
- [ ] Steps 2–9

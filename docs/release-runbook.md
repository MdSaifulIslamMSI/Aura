# Release Runbook

## Staging Deploy

1. Ensure CI, security, Docker, Helm, and OpenTofu validation checks are green.
2. Build and push a staging image through the configured registry workflow.
3. Update `charts/app/values-staging.yaml` with the staging image tag.
4. Let Argo CD sync `gitops/argocd/app-staging.yaml`, or run a manual sync:

   ```sh
   argocd app sync aura-api-staging
   argocd app wait aura-api-staging --health --sync
   ```

5. Check rollout:

   ```sh
   kubectl -n aura-staging rollout status deploy/aura-api
   kubectl -n aura-staging get pods,hpa,pdb
   ```

## Staging Smoke

```sh
npm run env:validate:staging
curl --fail --show-error --silent "$STAGING_HEALTH_URL"
npm run smoke:staging
```

Staging must never use production URLs or production secrets.

## Promote To Production

1. Confirm staging smoke is green.
2. Review diff from staging to production values.
3. Copy the approved image tag to `charts/app/values-production.yaml`.
4. Open a PR for production promotion.
5. Merge only after required checks pass.
6. Apply or sync the production Argo CD application manually after approval.

Production sync is intentionally not automated by this foundation.

## Ownership Checklist

- Release owner named.
- Rollback owner named.
- Staging smoke evidence attached.
- Production secret source confirmed outside Git.
- Argo CD sync status checked.
- Metrics and logs checked for the first 30 minutes.

# Rollback Runbook

## Kubernetes Rollback

1. Stop further promotion or sync automation if a bad deployment is still rolling out.
2. Inspect rollout:

   ```sh
   kubectl -n aura-staging rollout status deploy/aura-api
   kubectl -n aura-staging describe deploy/aura-api
   kubectl -n aura-staging get events --sort-by=.lastTimestamp
   ```

3. Roll back to the previous ReplicaSet:

   ```sh
   kubectl -n aura-staging rollout undo deploy/aura-api
   kubectl -n aura-staging rollout status deploy/aura-api
   ```

4. If Argo CD reverts the rollback, revert the Git commit or change the Helm image tag to the last known good tag and sync.

## Argo CD Rollback

```sh
argocd app history aura-api-staging
argocd app rollback aura-api-staging <revision>
argocd app wait aura-api-staging --health --sync
```

## Verification

- `curl --fail "$STAGING_HEALTH_URL"`
- `kubectl -n aura-staging get pods`
- Grafana dashboard error rate and latency panels.
- Loki logs filtered by `service="aura-marketplace-api"`.

## Disable Bad Deployment

- Scale the deployment to zero only if the service is actively harmful:

  ```sh
  kubectl -n aura-staging scale deploy/aura-api --replicas=0
  ```

- Prefer rollback over scale-down for availability incidents.

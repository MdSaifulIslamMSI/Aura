# GitOps Readiness

Argo CD is the intended continuous delivery controller. Desired state lives in Git under `charts/app`, and Argo CD compares that desired state with the live cluster.

## Staging Bootstrap

1. Install Argo CD in a non-production cluster or staging namespace.
2. Connect this repository to Argo CD.
3. Review `charts/app/values-staging.yaml` and create the `aura-api-secrets` Kubernetes secret out of band.
4. Apply the staging application:

   ```sh
   kubectl apply -f gitops/argocd/app-staging.yaml
   ```

5. Verify sync and health:

   ```sh
   argocd app get aura-api-staging
   kubectl -n aura-staging rollout status deploy/aura-api
   kubectl -n aura-staging get hpa,pdb,networkpolicy
   ```

The staging app enables automated sync with prune and self-heal. This is safe only when the staging cluster is isolated, secrets are managed outside Git, and `values-staging.yaml` points at staging services.

## Production Bootstrap

`gitops/argocd/app-production.example.yaml` is example-only. Before applying it:

- Replace example domains and image tags.
- Confirm production secrets exist outside Git.
- Disable automated sync unless the release process explicitly approves it.
- Promote only after CI, security checks, image scan, Helm template, and staging smoke are green.

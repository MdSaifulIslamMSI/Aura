# feat(devops): add scalable DevOps superstack foundation

## Summary

Adds a free/open-source DevOps foundation for Docker, GitHub Actions, OpenTofu, Kubernetes, Helm, Argo CD GitOps, OpenTelemetry, Prometheus, Grafana, Loki, environment validation, release safety, and local task running.

## Files Changed

- Root Dockerfile, Docker Compose, Docker ignore, Makefile, and package scripts.
- Environment examples and validation scripts.
- Kubernetes base manifests under `k8s/base`.
- Helm chart under `charts/app`.
- OpenTofu examples under `infra/opentofu`.
- Argo CD manifests under `gitops/argocd`.
- Observability assets under `observability`.
- CI, security, Docker, and staging smoke workflows.
- Release, rollback, incident, scaling, inventory, and security checklist docs.

## Validation Commands

```sh
npm run env:validate
npm run env:validate:staging
npm run env:validate:production
npm run lint
npm run typecheck
npm test # with TEST_MONGO_URI=mongodb://127.0.0.1:27017/aura_test and Docker-backed Mongo
npm run build
npm --prefix server test -- --runTestsByPath tests/healthRoutes.test.js tests/healthDisclosureService.test.js tests/healthReadinessService.test.js
npm run observability:validate
docker compose config
docker compose -f docker-compose.observability.yml config
docker build --no-cache -t aura-api:local .
docker compose up -d --build aura-api && curl http://127.0.0.1:5000/health/live
kubectl kustomize k8s/base
kubectl kustomize k8s/base | kubeconform -strict -ignore-missing-schemas
helm lint charts/app
helm template aura charts/app -f charts/app/values-staging.yaml
helm template aura charts/app -f charts/app/values-production.yaml
tofu -chdir=infra/opentofu fmt -recursive -check
tofu -chdir=infra/opentofu init -backend=false
tofu -chdir=infra/opentofu validate
npm run security:secrets
npm run security:gitleaks
npm run security:deps
npm run security:hadolint
npm run security:iac # report-only; residual findings captured for follow-up
npm run security:trivy:image -- aura-api:local
npm run sbom:generate
```

## Risks

- Real cluster, registry, DNS, TLS, and cloud credentials remain manual.
- NetworkPolicy egress should be tightened once final dependency CIDRs are known.
- Production Argo CD manifest is example-only.
- IaC scanner still reports residual advisory findings in pre-existing CloudFormation and a few validation-only examples; CI keeps this report-only until ownership decisions are made.
- `npm sbom` cannot resolve one optional MongoDB metadata lockfile conflict in `server`; the SBOM script falls back to a structured package-lock CycloneDX emitter for that workspace.

## Rollout Plan

1. Merge after CI/security/docker checks are green.
2. Build and tag staging image.
3. Create Kubernetes secrets outside Git.
4. Bootstrap Argo CD staging app.
5. Run staging smoke.
6. Promote production manually after approval.

## Rollback Plan

Rollback through Kubernetes `rollout undo` or Argo CD app rollback, then revert Git desired state to the last known good chart values.

## Follow-Up Items

- Replace example image repository and domains.
- Add real registry publishing when GHCR/ECR permissions are configured.
- Install metrics-server and Argo CD in staging.
- Decide whether production sync should ever be automated.

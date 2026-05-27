# Scaling Runbook

## Horizontal Pod Autoscaling

The Kubernetes base and Helm chart include `autoscaling/v2` HPA. HPA is valid because the Deployment defines CPU and memory requests.

Requirements:

- metrics-server installed in the cluster.
- Deployment exposes the scale subresource, which Kubernetes Deployments do by default.
- Resource requests remain defined for every container.

Check HPA:

```sh
kubectl -n aura-staging get hpa aura-api
kubectl -n aura-staging describe hpa aura-api
```

## Manual Scale

Use manual scale only for short incident response windows:

```sh
kubectl -n aura-staging scale deploy/aura-api --replicas=3
kubectl -n aura-staging rollout status deploy/aura-api
```

Commit the desired steady-state replica or HPA change to Git afterward so Argo CD does not drift.

## Capacity Signals

- CPU above 70 percent for 10 minutes.
- Memory above 80 percent for 10 minutes.
- 5xx rate above 5 percent.
- MongoDB or Redis dependency latency increasing.
- Queue worker gaps in `/health/ready`.

## NetworkPolicy Tightening

The starter NetworkPolicy allows outbound DNS, HTTP, HTTPS, MongoDB, and Redis for compatibility. Replace broad egress with namespace selectors, service CIDRs, or private endpoint CIDRs when the target cluster topology is known.

# Release Rollout

## Main files

- `infra/aws/deploy-release.sh`
- `infra/aws/docker-compose.ec2.yml`
- `.github/workflows/deploy-backend-aws.yml`

## Rollout shape

- Build backend image in GitHub Actions
- Archive infra bundle and upload both artifacts to S3
- Resolve the running backend instance
- Send an SSM shell script command
- Download artifacts on the EC2 host
- Extract infra bundle and load the Docker image
- Render runtime secrets
- Write `release.env`
- Enforce trusted-device runtime contract
- Start services with Docker Compose
- Poll `/health/ready`

## Important checks

- `AUTH_DEVICE_CHALLENGE_MODE` must not resolve to `off` or blank
- A usable device secret or allowed vault fallback must be present
- API should become healthy on `http://127.0.0.1:5000/health/ready`
- Failing readiness should surface recent Compose logs

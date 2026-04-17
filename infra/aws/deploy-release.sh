#!/usr/bin/env bash
set -euo pipefail

deploy_root="${AURA_DEPLOY_ROOT:-/opt/aura}"
release_sha="${AURA_RELEASE_SHA:?AURA_RELEASE_SHA is required}"
deploy_bucket="${AURA_DEPLOY_BUCKET:?AURA_DEPLOY_BUCKET is required}"
infra_bundle_key="${AURA_INFRA_BUNDLE_KEY:?AURA_INFRA_BUNDLE_KEY is required}"
image_bundle_key="${AURA_IMAGE_BUNDLE_KEY:?AURA_IMAGE_BUNDLE_KEY is required}"
aws_region="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"

if [[ -z "${aws_region}" ]]; then
  echo "AWS_REGION or AWS_DEFAULT_REGION is required" >&2
  exit 1
fi

release_dir="${deploy_root}/releases/${release_sha}"
current_dir="${deploy_root}/current"
shared_dir="${deploy_root}/shared"

mkdir -p "${release_dir}" "${current_dir}" "${shared_dir}"

aws s3 cp --region "${aws_region}" "s3://${deploy_bucket}/${infra_bundle_key}" "${release_dir}/infra.tar.gz"
aws s3 cp --region "${aws_region}" "s3://${deploy_bucket}/${image_bundle_key}" "${release_dir}/image.tar.gz"

rm -rf "${current_dir}"
mkdir -p "${current_dir}"

tar -xzf "${release_dir}/infra.tar.gz" -C "${current_dir}"
gunzip -c "${release_dir}/image.tar.gz" | docker load

bash "${current_dir}/infra/aws/render-runtime-secrets.sh"

cat > "${shared_dir}/release.env" <<EOF
AURA_BACKEND_IMAGE=aura-backend:${release_sha}
AURA_APP_BUILD_SHA=${release_sha}
EOF

chmod 600 "${shared_dir}/release.env"

docker compose \
  --env-file "${shared_dir}/base.env" \
  --env-file "${shared_dir}/runtime-secrets.env" \
  --env-file "${shared_dir}/release.env" \
  -f "${current_dir}/infra/aws/docker-compose.ec2.yml" \
  up -d --remove-orphans

for _ in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:5000/health/ready > /dev/null; then
    echo "Aura backend release ${release_sha} is healthy."
    exit 0
  fi
  sleep 10
done

echo "Aura backend release ${release_sha} failed readiness checks." >&2
exit 1

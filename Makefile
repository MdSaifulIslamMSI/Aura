.PHONY: devops-check docker-build k8s-validate helm-lint observability-validate ci-local

devops-check:
	npm run env:validate
	npm run env:validate:staging
	npm run env:validate:production
	npm run lint
	npm run typecheck
	npm test
	npm run build
	$(MAKE) docker-build
	$(MAKE) k8s-validate
	$(MAKE) helm-lint
	$(MAKE) observability-validate
	@if command -v tofu >/dev/null 2>&1; then npm run tofu:fmt && npm run tofu:validate; else echo "OpenTofu not found; install tofu to validate infra/opentofu locally."; fi

docker-build:
	@if command -v docker >/dev/null 2>&1; then npm run docker:build; else echo "Docker not found; install Docker to build the local image."; fi

k8s-validate:
	@if command -v kubectl >/dev/null 2>&1; then kubectl kustomize k8s/base >/tmp/aura-k8s-base.yaml; elif command -v kustomize >/dev/null 2>&1; then kustomize build k8s/base >/tmp/aura-k8s-base.yaml; else echo "kubectl or kustomize not found; install one to validate k8s/base locally."; fi
	@if command -v kubeconform >/dev/null 2>&1 && test -f /tmp/aura-k8s-base.yaml; then kubeconform -strict -summary -ignore-missing-schemas /tmp/aura-k8s-base.yaml; else echo "kubeconform not found; install it for Kubernetes schema validation."; fi

helm-lint:
	@if command -v helm >/dev/null 2>&1; then npm run helm:lint && npm run helm:template:staging >/dev/null && npm run helm:template:production >/dev/null; else echo "Helm not found; install Helm 3 to lint charts/app locally."; fi

observability-validate:
	npm run observability:validate

ci-local:
	npm run env:validate
	npm run lint
	npm run typecheck
	npm test
	npm run build

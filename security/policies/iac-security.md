# Infrastructure As Code Security Policy

Last updated: 2026-05-25

Infrastructure definitions are production code and must be scanned before merge. This repository uses Trivy misconfiguration scanning as the existing hard gate and adds Checkov, tfsec, and Terrascan report artifacts for deeper IaC evidence.

## Required Scanners

| Scanner | Coverage | CI Artifact |
|---|---|---|
| Trivy config | Docker, Compose, CloudFormation, Kubernetes-like config, secrets | `trivy-fs-reports` |
| Checkov | CloudFormation, Dockerfile, GitHub Actions, Kubernetes, secrets | `checkov-report.json` |
| tfsec | Terraform if added later | `tfsec-report.json` |
| Terrascan | IaC policy sweep for supported manifests | `terrascan-report.json` |

## Review Requirements

- Critical and high Trivy misconfig findings block merge.
- Checkov, tfsec, and Terrascan reports must be uploaded on every security-gates run.
- Newly introduced high-risk IaC findings need either a fix or an accepted risk entry.
- Cloud security posture checks must be attached for production AWS, CloudFront, WAF, DNS, and storage changes.
- Docker Compose and runtime manifests must include least privilege, no-new-privileges, resource limits, and only required ports.

## Definition Of Done

- CI has IaC scan artifacts.
- Risk register links accepted IaC findings.
- Cloud posture review evidence exists before production infrastructure changes.

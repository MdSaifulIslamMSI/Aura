# Zero Trust Service Mesh Policy

Last updated: 2026-05-25

Internal traffic is not trusted just because it is inside the VPC, host, compose network, or cluster. Every service-to-service call must have identity, authentication, authorization, egress rules, telemetry, and revocation.

## Required Controls

| Control | Requirement | Evidence |
|---|---|---|
| Service identity | Each service has a distinct workload identity or service account | Platform identity inventory |
| mTLS | Internal service calls use mTLS where platform support exists | Mesh or proxy config export |
| Internal API authorization | Internal APIs check caller service identity and action | Integration test or policy test |
| Network segmentation | Services can only reach required peers and ports | Security group, compose, or network policy |
| Egress control | Outbound domains are allowlisted for sensitive integrations | Egress policy and SSRF tests |
| Least privilege | Service accounts have only required cloud/API permissions | IAM review and access review |
| Telemetry | Internal auth failures and egress blocks are logged | `service.authz.denied`, `egress.private_ip_blocked` |

## Definition Of Done

- No shared catch-all production service account.
- No unrestricted internal service-to-service network path for privileged APIs.
- Internal API calls fail closed when service identity is absent or unauthorized.
- Egress to metadata, localhost, private ranges, and unapproved domains is blocked.
- Access review covers service accounts monthly.

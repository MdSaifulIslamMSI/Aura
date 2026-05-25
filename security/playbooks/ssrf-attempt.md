# SSRF Attempt Playbook

## Trigger

- `egress.private_ip_blocked`.
- Attempted access to localhost, private ranges, cloud metadata, or unapproved domains.
- Remote media/catalog fetch anomaly.

## Immediate Actions

1. Preserve request ID, target URL, resolved IP, user ID, and route.
2. Block the source IP or account if active probing continues.
3. Confirm no redirect bypass reached a private address.
4. Review outbound request logs for the same source.
5. Patch allowlist or resolver logic if a gap is found.

## Evidence

- Original URL and final resolved destination.
- DNS resolution result.
- Redirect chain.
- Egress policy decision.
- Request IDs and source identity.

## Recovery

- Add test for the bypass variant.
- Rotate metadata-accessible credentials if exposure is suspected.
- Close with updated egress domain register.

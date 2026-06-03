# Runtime Security

Optional free/open-source runtime layers:

- Falco for container/runtime threat detection.
- Wazuh for host/SIEM visibility.
- osquery for host inventory.
- fail2ban or nftables/iptables for host-level blocking.
- Trivy, Grype, and Syft for image and dependency visibility.

These are not required in local development. Stage them before production and keep detection mode until false positives are reviewed.

# Data Governance And DLP Policy

Last updated: 2026-05-25

Data protection must cover what data exists, how sensitive it is, where it flows, how long it stays, and how it is deleted or exported.

## Classification

| Class | Examples | Required Protection |
|---|---|---|
| Public | Product metadata, public catalog content | Integrity checks, abuse monitoring |
| Internal | Operational logs, non-sensitive metrics | Access controls, retention limits |
| Confidential | Email, phone, address, order metadata, device/IP signals | Encryption, least privilege, redaction |
| Restricted | Payment-like metadata, secrets, admin actions, sensitive uploaded files | Field-level encryption or tokenization where feasible, audit logs, strict access |

## Required Controls

- PII inventory is updated when fields, logs, analytics, or third parties change.
- Logs redact passwords, tokens, cookies, OTPs, secrets, and full payment details.
- DLP rules flag secrets/PII in logs, uploads, support exports, and CI artifacts.
- Retention periods are defined for account data, uploads, logs, payment metadata, and backups.
- Right-to-delete and export workflows are documented and tested.
- Restricted fields use field-level encryption, tokenization, or provider-side vaulting where feasible.

## Definition Of Done

- Every PII field maps to purpose, storage, retention, owner, and access path.
- User export/delete evidence exists.
- DLP alert test exists.
- Sensitive data access is audited.

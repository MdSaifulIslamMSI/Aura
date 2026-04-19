# IAM Auth

Use this skill for:

- IAM role and policy design
- STS and assumed-role debugging
- Cross-account trust relationships
- Permission boundary and deny analysis
- AWS CLI profile and credential confusion

## Review Checklist

- Which principal is making the call?
- Which policy types apply: identity, resource, SCP, boundary, session?
- Does the trust policy allow the principal to assume the role?
- Is the failure authn, authz, or region/profile confusion?

# PQC Provider Dependency Register

Unknown entries are intentionally recorded as `unknown/provider-dependent` unless Aura has direct, current provider evidence. This register avoids inventing provider claims.

| Provider/Surface | Provider-Controlled Crypto | Known PQC Support | Aura Can Control | Aura Cannot Control | Risk Level | Monitoring Owner | Review Cadence | Migration Trigger | Fallback/Rollback Note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Firebase/Auth | Token signing, hosted auth transport, SDK internals | unknown/provider-dependent | Token verification, session lifetime, auth gates | Firebase issuer algorithms and hosted transport internals | medium | Security/Auth | quarterly | Firebase announces supported PQ/hybrid token or transport migration | Keep existing verified token flow and rotate credentials |
| Stripe | API TLS, webhook signature scheme, SDK internals | unknown/provider-dependent | Webhook verification, replay defense, credential rotation | Stripe transport/signature internals | medium | Payments | quarterly | Stripe publishes PQC roadmap or migration guidance | Keep current webhook verification and rotate keys |
| Razorpay | API TLS, webhook signature scheme, SDK internals | unknown/provider-dependent | Webhook verification, replay defense, credential rotation | Razorpay transport/signature internals | medium | Payments | quarterly | Razorpay publishes PQC roadmap or migration guidance | Keep current webhook verification and rotate keys |
| Resend/email | API/SMTP TLS, DKIM/email ecosystem | unknown/provider-dependent | Credential rotation, redacted logging, provider selection | Provider transport and email signature ecosystem | medium | Messaging | quarterly | Provider or DKIM ecosystem supports PQ signatures | Revert to approved provider config |
| MongoDB host | Provider TLS, cert chain, backup crypto if hosted | unknown/provider-dependent | Connection config, TLS requirement, credential rotation | Provider TLS implementation and cert chain | medium | Platform | quarterly | Provider supports hybrid/PQ TLS or cert migration | Revert endpoint while keeping least privilege |
| Redis host | Provider TLS/private network, ACL implementation | unknown/provider-dependent | `rediss://`, private network, credential rotation | Provider TLS implementation | medium | Platform | quarterly | Provider supports hybrid/PQ TLS or updated cert policy | Revert to private-network route with ACLs |
| Vercel/Netlify/CloudFront/Caddy/Nginx edge | Provider or edge TLS | unknown/provider-dependent for browser PQC | TLS 1.3 examples, HSTS, provider choice | Browser/WebPKI PQC acceptance | medium | Platform | quarterly | Provider/browser support hybrid PQC at edge | Revert edge setting to stable TLS 1.3 |
| GitHub Actions | Hosted runner transport, secret storage, OIDC internals | unknown/provider-dependent | OIDC use, secret minimization, scanner gates | GitHub service crypto internals | medium | DevOps | quarterly | GitHub updates OIDC/artifact attestations for PQ signatures | Revoke secret/OIDC role and restore previous policy |
| AI providers | API TLS, model gateway SDK internals | unknown/provider-dependent | Gateway selection, auth, rate limits, no secret logging | Provider transport and SDK crypto | medium | AI Platform | quarterly | Provider announces PQ/hybrid transport support | Disable provider route or restore previous model config |
| Browser/WebPKI | Browser TLS, cert validation, CA ecosystem | unknown/provider-dependent | HSTS, TLS 1.3 edge config, cert rotation | Browser PQC support and public CA acceptance | high | Platform | quarterly | Browser/WebPKI supports hybrid PQC broadly | Stable TLS 1.3 rollback |
| Mobile app stores | App signing and distribution verification | unknown/provider-dependent | App metadata, signing hygiene, credential rotation | Store signature algorithms and verification rules | medium | Release | quarterly | Store supports PQ release signatures | Keep classical platform signing |

## Monitoring Rule

Provider-dependent does not mean ignored. Each review records current provider documentation, migration triggers, and any required staging proof before production change.

## Verification

```sh
node scripts/security/pqc-provider-register-check.mjs --json --markdown
```

Unknown/provider-dependent rows are warnings, not repo failures. They intentionally lower the full end-to-end PQC maturity score until provider evidence becomes verifiable.

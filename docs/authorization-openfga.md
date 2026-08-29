# Fine-Grained Authorization — OpenFGA (Phase 4)

Fine-grained ReBAC for the marketplace, using [OpenFGA](https://openfga.dev)
(CNCF project, self-hosted, free). This is additive and flag-controlled:
while `OPENFGA_ENFORCEMENT_MODE` is `off` (the default), the legacy
seller/admin checks decide everything and the service is inert.

## Components

| Piece | Path |
| --- | --- |
| Server (dev/CI, in-memory) | `infra/security/openfga/docker-compose.yml` (`openfga/openfga:v1.19.0`) |
| Authorization model | `infra/security/openfga/authorization-model.json` |
| Service client | `server/services/authorization/openFgaService.js` (plain fetch, no SDK) |
| Enforcement seam | `server/controllers/listingController.js` — `updateListing` / `deleteListing` |
| Owner tuple sync | `createListing` writes `user:<id> owner listing:<id>` (best-effort) |
| Live verification | `scripts/security/openfga-verification.mjs` + `.github/workflows/openfga-authorization-verify.yml` |

## Model

- `listing`: `owner`, `admin`, `editor` (= owner or admin)
- `order`: `buyer`, `seller`, `admin`, `viewer` (= buyer or seller or admin)

Tuples are `user:<id> <relation> listing:<id>` / `order:<id>`.

## Configuration

| Env | Meaning |
| --- | --- |
| `OPENFGA_API_URL` | OpenFGA server base URL (e.g. `http://127.0.0.1:8081`) |
| `OPENFGA_STORE_ID` | Store id created inside OpenFGA |
| `OPENFGA_AUTHORIZATION_MODEL_ID` | Model id returned when the model was written |
| `OPENFGA_API_TOKEN` | Optional bearer token |
| `OPENFGA_ENFORCEMENT_MODE` | `off` (default) / `monitor` / `enforce` |
| `OPENFGA_TIMEOUT_MS` | Per-request timeout (default 3000) |

## Rollout

1. **off** (default): deploy with tuples unwritten; nothing changes.
2. **monitor**: set `monitor` in staging — FGA evaluates and logs
   disagreements but the legacy seller check decides. Review logs until
   disagreements are understood (they should only be admin grants).
3. **Backfill**: write `owner` tuples for all existing listings.
4. **enforce**: FGA decides. Transport errors fail **closed**. Only enable
   after the backfill is verified.

## Verify locally

```bash
docker compose -f infra/security/openfga/docker-compose.yml up -d --wait
npm run security:openfga:verify -- --api-url http://127.0.0.1:8081
docker compose -f infra/security/openfga/docker-compose.yml down
```

The verification creates a throwaway store, writes the model and owner/admin
tuples, and asserts: owner → editor allowed, admin → editor allowed (FGA grant
beyond the legacy check), unrelated user → denied, undeclared relations rejected.

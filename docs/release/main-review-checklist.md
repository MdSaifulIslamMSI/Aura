# Main Review Checklist

- [ ] Is staging full-stack, not frontend-only?
- [ ] Did staging point to the current EC2 host?
- [ ] Did health say `env=staging`?
- [ ] Did staging avoid the production SSM prefix?
- [ ] Did cost guard pass?
- [ ] Did rollback proof pass?
- [ ] Did artifact SHA verification pass?
- [ ] Did frontend service worker/cache avoid stale broken code?
- [ ] Did production mutation gate stay closed until merge?
- [ ] Did all CI checks pass?
- [ ] Did PR diff avoid secrets?
- [ ] Did IAM permissions stay least-privilege?
- [ ] Did no paid AWS resource get created?

## Commands

```sh
npm run staging:state:refresh
npm run smoke:staging
npm run smoke:staging:frontend
npm run smoke:env-contract
npm run aws:cost-guard
npm run aws:observability:guard
npm run release:rollback-ready
npm run security:secrets
npm test
git status --short
git diff --stat
git diff --check
```

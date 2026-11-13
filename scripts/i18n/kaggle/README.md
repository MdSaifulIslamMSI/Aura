# Kaggle GPU i18n AST-Repair Pipeline

All heavy neural machine translation (`NLLB-200`) for Aura's 19-locale ICU repair runs remotely inside **Kaggle Cloud GPUs** (zero local CPU/GPU load).

## Prerequisites

1. Install Kaggle CLI (`pip install kaggle`) and place your Kaggle API token in `~/.kaggle/kaggle.json` (never inside the repository).
2. Ensure the private datasets (`<owner>/aura-i18n-repair-tasks` and optional `<owner>/aura-nllb-ct2-offline`) exist on your Kaggle account.

## End-to-End Commands

```sh
# 1. Verify Kaggle CLI & owner config
npm run i18n:kaggle:doctor

# 2. Extract AST-masked NLLB segments, push private dataset + GPU kernel, wait, pull & apply
npm run i18n:kaggle:run

# Or step-by-step:
npm run i18n:kaggle:extract
npm run i18n:kaggle:push
npm run i18n:kaggle:status
npm run i18n:kaggle:apply

# 3. Regenerate unified runtime catalogs & verify all QA gates
npm run i18n:stable-catalogs
npm --prefix app run i18n:check
```

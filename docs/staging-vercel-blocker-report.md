# Vercel Staging Blocker Report

Current status: Vercel custom staging is blocked, but live staging frontend is present through Docker on AWS staging.

## What Is Blocked

- Vercel custom environment `staging` cannot be created for the current project capability. The API/CLI returned: `Cannot create more than 0 custom environments. (400)`.
- Branch-scoped Preview environment writes failed because the Vercel project is not connected to a Git repository.
- The generated Vercel Preview deployment is protected by Vercel Deployment Protection, so it returns `401` without an automation bypass secret.

## Safe Fallback In Use

The active frontend staging URL is:

```text
http://ec2-13-201-55-118.ap-south-1.compute.amazonaws.com
```

That URL is served by Docker on the AWS staging EC2 instance:

- `/` serves the static Vite frontend from `nginx:alpine`.
- `/api`, `/health`, `/uploads`, and `/socket.io` are routed by host Nginx to the isolated AWS staging backend.
- The backend health contract reports `env: staging` and `ssmPrefix: /aura/staging`.
- `npm run smoke:staging:frontend` passed against this Docker-hosted frontend.

## Required Fix For Vercel Mode

- Connect the Vercel project to the GitHub repository if branch-scoped Preview env is required.
- Upgrade or change Vercel project capability if a custom `staging` environment is required.
- Keep Deployment Protection automation bypass secret in the GitHub `staging` environment if protected Preview smoke is used.

Vercel Preview remains frontend-only until it passes the same staging smoke contract as the Docker-hosted AWS frontend.

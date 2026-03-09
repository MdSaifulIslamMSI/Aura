# Aura AWS Backend + Vercel Frontend

This repo is ready for a split deployment:

- `app` stays on Vercel
- `server` moves to AWS ECS Fargate
- uploads move from local disk to S3

## Target architecture

- `Route 53` for `api.yourdomain.com`
- `ACM` certificate in the ALB region
- `ALB` with HTTPS listener
- `ECR` repository for the backend image
- `ECS Fargate` service for the API
- `Secrets Manager` for backend secrets
- `CloudWatch Logs` for app logs
- `S3` for review media uploads
- `EventBridge Scheduler` for scheduled jobs
- `SQS` for future async/worker workloads

## Backend container

The backend already builds from:

- [server/Dockerfile](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/server/Dockerfile)

Build and push pattern:

```bash
docker build -t aura-api ./server
docker tag aura-api:latest <account>.dkr.ecr.<region>.amazonaws.com/aura-api:latest
docker push <account>.dkr.ecr.<region>.amazonaws.com/aura-api:latest
```

## ECS service shape

- Launch type: `Fargate`
- Port: `5000`
- Health check path: `/health/ready`
- Desired count: `2`
- CPU: `1024`
- Memory: `2048`

Use the task definition template:

- [ecs-task-definition.template.json](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/infra/aws/ecs-task-definition.template.json)
- [render-task-definition.mjs](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/infra/aws/render-task-definition.mjs)
- [iam-task-role-policy.template.json](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/infra/aws/iam-task-role-policy.template.json)
- [bootstrap-backend.ps1](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/infra/aws/bootstrap-backend.ps1)

## Required backend secrets

Store these in `AWS Secrets Manager` and wire them into the ECS task:

- `MONGO_URI`
- `REDIS_URL`
- `BYTEZ_API_KEY`
- `UPLOAD_SIGNING_SECRET`
- `OTP_CHALLENGE_SECRET`
- `JWT_SECRET` if used in your auth flow
- Firebase admin secrets
- mail/SMS/payment provider secrets that are enabled in production

## Required backend environment variables

Non-secret environment values for ECS:

- `NODE_ENV=production`
- `PORT=5000`
- `CORS_ORIGIN=https://your-frontend-domain.vercel.app`
- `APP_PUBLIC_URL=https://your-frontend-domain.vercel.app`
- `REDIS_ENABLED=true`
- `REDIS_REQUIRED=true`
- `SPLIT_RUNTIME_ENABLED=true`
- `UPLOAD_STORAGE_DRIVER=s3`
- `REVIEW_UPLOAD_S3_BUCKET=<bucket-name>`
- `REVIEW_UPLOAD_S3_PREFIX=reviews`
- `REVIEW_UPLOAD_PUBLIC_BASE_URL=` optionally set this only if you put CloudFront or another CDN in front of uploads

## Frontend on Vercel

Do not hardcode the AWS backend into `vercel.json` until the API is live.

Instead:

1. Set `VITE_API_URL=https://api.yourdomain.com/api` in Vercel.
2. Redeploy the frontend.
3. Keep the existing rewrites only as a fallback until traffic is fully cut over.

The frontend client already supports this via:

- [app/src/services/apiBase.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/app/src/services/apiBase.js)

## Upload migration note

The current backend can store review media either:

- locally for development
- in S3 for ECS/Fargate

That logic is implemented in:

- [server/services/reviewMediaStorageService.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/server/services/reviewMediaStorageService.js)

When S3 storage is enabled and no CDN URL is configured, the backend serves review media from S3 through `/uploads/reviews/...`, so the bucket does not need to be public.

## GitHub secrets for the deploy workflow

Set these repository secrets before enabling:

- `AWS_REGION`
- `AWS_ACCOUNT_ID`
- `AWS_GITHUB_DEPLOY_ROLE_ARN`
- `AWS_ECR_REPOSITORY`
- `AWS_ECS_CLUSTER`
- `AWS_ECS_SERVICE`
- `FRONTEND_ORIGIN`
- `APP_PUBLIC_URL`
- `REVIEW_UPLOAD_S3_BUCKET`
- `REVIEW_UPLOAD_S3_PREFIX`
- `REVIEW_UPLOAD_PUBLIC_BASE_URL`
- `ECS_TASK_EXECUTION_ROLE_ARN`
- `ECS_TASK_ROLE_ARN`
- `MONGO_URI_SECRET_ARN`
- `REDIS_URL_SECRET_ARN`
- `BYTEZ_API_KEY_SECRET_ARN`
- `UPLOAD_SIGNING_SECRET_SECRET_ARN`

## Rollout order

1. Create ECR, ECS cluster, ALB, ACM cert, and S3 bucket.
2. Add secrets to Secrets Manager.
3. Deploy the backend with the ECS task definition template.
4. Verify `https://api.yourdomain.com/health/ready`.
5. Set `VITE_API_URL=https://api.yourdomain.com/api` in Vercel.
6. Redeploy the frontend.
7. Switch upload storage to S3 in ECS.
8. Replace Vercel cron with EventBridge or scheduled ECS tasks.

## Next repo tasks

- move cron jobs from [server/vercel.json](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/server/vercel.json) to AWS scheduling
- add an SQS-backed worker path for long-running AI and email jobs
- optionally add CloudFront in front of S3 uploads

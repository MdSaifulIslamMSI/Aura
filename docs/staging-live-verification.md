# Staging Live Verification

Final status: Code is staging-safe, and live staging infrastructure is present.

Generated: 2026-05-26T17:06:02Z

| Check | Value |
| --- | --- |
| EC2 instance id | i-0af0bd44f6463b11b |
| EC2 public DNS | ec2-13-201-55-118.ap-south-1.compute.amazonaws.com |
| Staging API base URL | http://ec2-13-201-55-118.ap-south-1.compute.amazonaws.com |
| Staging health URL | http://ec2-13-201-55-118.ap-south-1.compute.amazonaws.com/health |
| Frontend staging URL | http://ec2-13-201-55-118.ap-south-1.compute.amazonaws.com |
| Frontend staging mode | Docker static frontend on AWS staging |
| Frontend staging smoke | PASS |
| S3 bucket | aura-staging-uploads-942679464475-ap-south-1-v2 |
| SSM prefix | /aura/staging |
| GitHub staging vars configured | yes |
| Vercel vars configured | no |
| Route smoke | PASS |

Docker Compose status:

```text
backend running healthy
mongo running
postgres running
redis running
scanner running healthy
```

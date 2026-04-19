# Guardrails

## Main file

- `infra/aws/bootstrap-cost-guardrails.ps1`

## What it configures

- SNS topic for notifications
- AWS Budget with forecasted and actual thresholds
- Budget-triggered SSM action to stop the EC2 instance
- Scheduler role and one-shot expiration schedule for stop/terminate behavior

## Key assumptions

- Region defaults to `ap-south-1`
- Budget control plane calls use `us-east-1`
- The backend instance is resolved by tag when an explicit instance id is not supplied

## Review Checklist

- Does the backend instance tag still resolve correctly?
- Are the budget thresholds still appropriate for the current stack?
- Do IAM roles still scope to the required EC2 instance and services only?

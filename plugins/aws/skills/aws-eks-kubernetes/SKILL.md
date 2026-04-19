---
name: "aws-eks-kubernetes"
description: "AWS EKS and Kubernetes-on-AWS guidance. Use when designing, reviewing, or debugging EKS clusters, managed node groups, Fargate profiles, ingress, service exposure, IRSA, add-ons, networking, or operational issues running Kubernetes on AWS."
---

# AWS EKS Kubernetes

Use this skill for managed Kubernetes work in AWS.

## Do First

1. Read `references/eks.md`
2. Use AWS Knowledge and Documentation MCP for current EKS guidance
3. Use AWS API MCP to inspect cluster, node group, addon, and identity configuration when live access exists

## Rules

- Separate Kubernetes issues from AWS infrastructure issues before proposing fixes
- Review ingress, service exposure, IAM, and networking together
- Treat cluster upgrade, add-on compatibility, and node lifecycle as operational design concerns

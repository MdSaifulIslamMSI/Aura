# Data Lake And Analytics Playbook

## Use This When

You need to ingest events or files, manage schemas, query data efficiently, and
support reporting or warehouse-style analytics on AWS.

## Common AWS Building Blocks

- S3 for raw, staged, and curated data layers
- Glue for catalogs, crawlers, jobs, and schema management
- Athena for serverless SQL on lake data
- Kinesis for streaming ingestion when data arrives continuously
- Redshift when warehouse performance and modeling become central
- IAM and KMS for data access and encryption

## Plugin Skills To Pull In First

- `aws-s3-storage`
- `aws-analytics`
- `aws-event-driven`
- `aws-kms`
- `aws-iam-auth`
- `aws-observability`

## Copy-Paste Prompts

```text
Design an AWS analytics stack for batch and streaming ingestion with S3, Glue, Athena, and Redshift. Explain when each service becomes necessary.
```

```text
Review this AWS data platform for partitioning, schema evolution, access control, cost control, and operational visibility.
```

```text
Help me choose between a simpler lake-only design and a lake-plus-warehouse design on AWS for analytics and reporting.
```

## What Good Output Looks Like

- a clear boundary between raw, transformed, and serving layers
- honest tradeoffs around cost, complexity, and latency
- explicit attention to schema drift, partitioning, and permissions
- practical monitoring notes for ingestion, freshness, and query failure paths

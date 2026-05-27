output "environment" {
  description = "Environment represented by this OpenTofu configuration."
  value       = var.environment
}

output "container_image" {
  description = "Container image reference expected by deploy manifests."
  value       = var.container_image
}

output "domain_name" {
  description = "Optional environment domain name."
  value       = var.domain_name
}

output "ecr_repository_url" {
  description = "ECR repository URL when create_container_registry is enabled."
  value       = try(aws_ecr_repository.app[0].repository_url, null)
}

output "object_storage_bucket" {
  description = "S3 object storage bucket when enable_object_storage is enabled."
  value       = try(aws_s3_bucket.object_storage[0].bucket, null)
}

output "example_instance_id" {
  description = "Example EC2 instance id when create_example_infra and ami_id are set."
  value       = try(aws_instance.app[0].id, null)
}

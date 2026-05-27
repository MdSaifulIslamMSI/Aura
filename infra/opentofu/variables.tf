variable "region" {
  description = "AWS region for staging or production resources."
  type        = string
  default     = "ap-south-1"
}

variable "app_name" {
  description = "Short application name used in resource names and tags."
  type        = string
  default     = "aura"
}

variable "environment" {
  description = "Deployment environment. Use staging or production."
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "domain_name" {
  description = "Optional DNS name for ingress or load balancer records."
  type        = string
  default     = ""
}

variable "container_image" {
  description = "Container image reference to deploy."
  type        = string
  default     = "ghcr.io/owner/aura-api:1.1.0"
}

variable "instance_type" {
  description = "Free-tier friendly instance type for example EC2 staging."
  type        = string
  default     = "t3.micro"
}

variable "node_size" {
  description = "Logical Kubernetes node size used by downstream cluster modules."
  type        = string
  default     = "small"
}

variable "ami_id" {
  description = "Optional AMI id for the example EC2 host. Leave empty for validation-only plans."
  type        = string
  default     = ""
}

variable "ssh_ingress_cidr" {
  description = "CIDR allowed to SSH into the example host. Keep empty to disable SSH."
  type        = string
  default     = ""
}

variable "create_example_infra" {
  description = "When true, create the example AWS resources. CI must keep this false."
  type        = bool
  default     = false
}

variable "create_container_registry" {
  description = "When true, create an ECR repository for application images."
  type        = bool
  default     = false
}

variable "enable_object_storage" {
  description = "When true, create an S3 bucket for object storage."
  type        = bool
  default     = false
}

variable "monthly_budget_usd" {
  description = "Documentation-only budget target for the environment."
  type        = number
  default     = 5
}

locals {
  name_prefix = "${var.app_name}-${var.environment}"
  common_tags = {
    Application = var.app_name
    Environment = var.environment
    ManagedBy   = "opentofu"
    Repository  = "Aura"
  }
}

resource "aws_ecr_repository" "app" {
  count = var.create_container_registry ? 1 : 0

  name                 = "${local.name_prefix}-api"
  image_tag_mutability = "IMMUTABLE"

  encryption_configuration {
    encryption_type = "AES256"
  }

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_s3_bucket" "object_storage" {
  count = var.enable_object_storage ? 1 : 0

  bucket = "${local.name_prefix}-uploads-example"
}

resource "aws_s3_bucket_versioning" "object_storage" {
  count = var.enable_object_storage ? 1 : 0

  bucket = aws_s3_bucket.object_storage[0].id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "object_storage" {
  count = var.enable_object_storage ? 1 : 0

  bucket = aws_s3_bucket.object_storage[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "object_storage" {
  count = var.enable_object_storage ? 1 : 0

  bucket                  = aws_s3_bucket.object_storage[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudwatch_log_group" "app" {
  count = var.create_example_infra ? 1 : 0

  name              = "/${var.app_name}/${var.environment}/api"
  retention_in_days = var.environment == "production" ? 30 : 14
}

resource "aws_security_group" "app" {
  count = var.create_example_infra ? 1 : 0

  name        = "${local.name_prefix}-api"
  description = "Example security group for ${local.name_prefix} API host"

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  dynamic "ingress" {
    for_each = var.ssh_ingress_cidr == "" ? [] : [var.ssh_ingress_cidr]
    content {
      description = "Operator SSH"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
    }
  }

  egress {
    description = "Outbound dependencies"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "app" {
  count = var.create_example_infra && var.ami_id != "" ? 1 : 0

  ami                         = var.ami_id
  instance_type               = var.instance_type
  vpc_security_group_ids      = [aws_security_group.app[0].id]
  associate_public_ip_address = true
  monitoring                  = true

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
    encrypted   = true
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }
}

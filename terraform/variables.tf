# General AWS

variable "aws_region" {
  type        = string
  description = "AWS Region"
}

variable "environment" {
  type        = string
  description = "Deployment Environment"
}

# Terraform Cloud

variable "tfe_org_name" {
  type        = string
  description = "Terraform Cloud organization name"
  default     = "ByItsCover"
}

variable "bic_infra_workspace" {
  type        = string
  description = "Terraform Cloud Workspace BIC-Infra name"
}

# Lambda

variable "lambda_name" {
  type        = string
  description = "Name of Lambda Function"
  default     = "library-search-lambda"
}

variable "lambda_memory" {
  type        = number
  description = "Memory in MB alloted to Lambda function"
  default     = 1024
}

variable "lambda_timeout" {
  type        = number
  description = "Lambda function timeout duration in seconds"
  default     = 30
}

variable "log_level" {
  type        = string
  description = "Application log level for Lambda Function"
  default     = "DEBUG"
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (staging or production)"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "Environment must be 'staging' or 'production'."
  }
}

variable "db_password" {
  description = "Password for RDS database"
  type        = string
  sensitive   = true
}

variable "jwt_secret" {
  description = "JWT secret for authentication"
  type        = string
  sensitive   = true
}

variable "polygon_rpc_url" {
  description = "Polygon RPC URL"
  type        = string
  default     = "https://polygon-rpc.com"
}

variable "blockchain_private_key" {
  description = "Private key for blockchain transactions"
  type        = string
  sensitive   = true
}

variable "sms_api_key" {
  description = "SMS provider API key"
  type        = string
  sensitive   = true
}

variable "sms_username" {
  description = "SMS provider username"
  type        = string
  default     = ""
}

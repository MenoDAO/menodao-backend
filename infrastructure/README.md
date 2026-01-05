# MenoDAO Infrastructure

This directory contains the Terraform configuration for deploying MenoDAO to AWS.

## Architecture

```
                                 ┌─────────────────────────┐
                                 │     CloudFront CDN      │
                                 │   (via AWS Amplify)     │
                                 └───────────┬─────────────┘
                                             │
    ┌────────────────────────────────────────┼────────────────────────────────────────┐
    │                                        │                                        │
    │         PRODUCTION                     │                 DEV                    │
    │                                        │                                        │
    │  ┌─────────────────────────┐           │    ┌─────────────────────────┐         │
    │  │   app.menodao.org       │           │    │   stg.menodao.org       │         │
    │  │   (Amplify - Next.js)   │           │    │   (Amplify - Next.js)   │         │
    │  └───────────┬─────────────┘           │    └───────────┬─────────────┘         │
    │              │                         │                │                       │
    │  ┌───────────▼─────────────┐           │    ┌───────────▼─────────────┐         │
    │  │   api.menodao.org       │           │    │  stg-api.menodao.org    │         │
    │  │   (ALB → ECS Fargate)   │           │    │  (ALB → ECS Fargate)    │         │
    │  │   - 2 tasks (auto-scale)│           │    │  - 1 task (Spot)        │         │
    │  └───────────┬─────────────┘           │    └───────────┬─────────────┘         │
    │              │                         │                │                       │
    │  ┌───────────▼─────────────┐           │    ┌───────────▼─────────────┐         │
    │  │   RDS PostgreSQL        │           │    │   RDS PostgreSQL        │         │
    │  │   (db.t3.small)         │           │    │   (db.t3.micro)         │         │
    │  └─────────────────────────┘           │    └─────────────────────────┘         │
    │                                        │                                        │
    └────────────────────────────────────────┴────────────────────────────────────────┘
```

## Cost Optimization

| Component | Production | Staging | Monthly Est. |
|-----------|------------|---------|--------------|
| ECS Fargate | 2 x 0.5 vCPU, 1GB | 1 x 0.25 vCPU, 0.5GB (Spot) | $25-40 |
| RDS PostgreSQL | db.t3.small | db.t3.micro | $15-30 |
| ALB | Per-region | Per-region | $20 |
| NAT Gateway | 2 (HA) | 1 (single) | $35-70 |
| ECR | Shared | Shared | $1-5 |
| Secrets Manager | 2 secrets | 1 secret | $1 |
| **Total** | | | **$100-170/mo** |

## Prerequisites

1. AWS CLI configured with credentials
2. Terraform >= 1.0
3. Domain `menodao.org` in Route 53

## Initial Setup

### 1. Create S3 bucket for Terraform state

```bash
aws s3 mb s3://menodao-terraform-state --region us-east-1
aws s3api put-bucket-versioning \
  --bucket menodao-terraform-state \
  --versioning-configuration Status=Enabled
```

### 2. Create DynamoDB table for state locking

```bash
aws dynamodb create-table \
  --table-name menodao-terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

### 3. Deploy Dev

```bash
cd infrastructure/terraform

# Initialize Terraform
terraform init

# Create dev workspace
terraform workspace new dev || terraform workspace select dev

# Plan deployment
terraform plan -var-file=dev.tfvars \
  -var="db_password=YOUR_SECURE_PASSWORD" \
  -var="jwt_secret=YOUR_JWT_SECRET" \
  -var="blockchain_private_key=YOUR_PRIVATE_KEY" \
  -var="sms_api_key=YOUR_SMS_API_KEY" \
  -var="sms_username=YOUR_SMS_USERNAME"

# Apply
terraform apply -var-file=dev.tfvars \
  -var="db_password=YOUR_SECURE_PASSWORD" \
  -var="jwt_secret=YOUR_JWT_SECRET" \
  -var="blockchain_private_key=YOUR_PRIVATE_KEY" \
  -var="sms_api_key=YOUR_SMS_API_KEY" \
  -var="sms_username=YOUR_SMS_USERNAME"
```

### 4. Deploy Production

```bash
# Create production workspace
terraform workspace new production || terraform workspace select production

# Plan and apply
terraform plan -var-file=production.tfvars -var="db_password=..."
terraform apply -var-file=production.tfvars -var="db_password=..."
```

## AWS Amplify Setup (Frontend)

### 1. Create Amplify App

```bash
aws amplify create-app \
  --name menodao-frontend \
  --repository https://github.com/MenoDAO/menodao-frontend \
  --access-token YOUR_GITHUB_TOKEN \
  --platform WEB \
  --environment-variables "NEXT_PUBLIC_API_URL=https://api.menodao.org"
```

### 2. Add branches

```bash
# Production branch
aws amplify create-branch \
  --app-id YOUR_APP_ID \
  --branch-name main \
  --stage PRODUCTION \
  --environment-variables "NEXT_PUBLIC_API_URL=https://api.menodao.org"

# Dev branch
aws amplify create-branch \
  --app-id YOUR_APP_ID \
  --branch-name dev \
  --stage DEVELOPMENT \
  --environment-variables "NEXT_PUBLIC_API_URL=https://stg-api.menodao.org"
```

### 3. Add custom domains

```bash
# Production domain
aws amplify create-domain-association \
  --app-id YOUR_APP_ID \
  --domain-name menodao.org \
  --sub-domain-settings prefix=app,branchName=main

# Dev domain
aws amplify create-domain-association \
  --app-id YOUR_APP_ID \
  --domain-name menodao.org \
  --sub-domain-settings prefix=stg,branchName=dev
```

## GitHub Secrets Required

Add these secrets to your GitHub repositories:

### Frontend (menodao-frontend)
- `AWS_ACCESS_KEY_ID` - AWS IAM access key
- `AWS_SECRET_ACCESS_KEY` - AWS IAM secret key
- `AMPLIFY_APP_ID` - Amplify app ID
- `GOOGLE_MAPS_API_KEY` - Google Maps API key

### Backend (menodao-backend)
- `AWS_ACCESS_KEY_ID` - AWS IAM access key
- `AWS_SECRET_ACCESS_KEY` - AWS IAM secret key
- `PRIVATE_SUBNET_IDS` - Private subnet IDs (comma-separated)
- `SECURITY_GROUP_ID` - ECS security group ID

## Deployment Workflow

### Automatic Deployments

| Branch | Environment | URL |
|--------|-------------|-----|
| `main` | Production | app.menodao.org / api.menodao.org |
| `dev` | Dev | stg.menodao.org / stg-api.menodao.org |

### Manual Dev Deployment

Comment on any PR to deploy to dev:
```
/deploy dev
```

## Database Migrations

Migrations run automatically during deployment. For manual migration:

```bash
aws ecs run-task \
  --cluster menodao-dev \
  --task-definition menodao-backend-dev-migrate \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx],securityGroups=[sg-xxx]}" \
  --launch-type FARGATE
```

## Monitoring

- **CloudWatch Logs**: `/ecs/menodao-production` and `/ecs/menodao-dev`
- **Container Insights**: Enabled for production
- **Health checks**: `/health` endpoint on port 3000

## Rollback

```bash
# Get previous task definition
aws ecs describe-services \
  --cluster menodao-production \
  --services menodao-backend-production

# Update service with previous revision
aws ecs update-service \
  --cluster menodao-production \
  --service menodao-backend-production \
  --task-definition menodao-backend-production:PREVIOUS_REVISION
```

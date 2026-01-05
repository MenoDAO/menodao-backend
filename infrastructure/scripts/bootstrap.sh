#!/bin/bash
set -e

# MenoDAO AWS Infrastructure Bootstrap Script
# This script sets up the initial AWS resources needed for Terraform

echo "🚀 MenoDAO Infrastructure Bootstrap"
echo "===================================="

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check if credentials are configured
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ AWS credentials not configured. Run 'aws configure' first."
    exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION="us-east-1"

echo "📍 AWS Account: $ACCOUNT_ID"
echo "📍 Region: $REGION"
echo ""

# 1. Create S3 bucket for Terraform state
echo "📦 Creating S3 bucket for Terraform state..."
BUCKET_NAME="menodao-terraform-state"
if aws s3 ls "s3://$BUCKET_NAME" 2>&1 | grep -q 'NoSuchBucket'; then
    aws s3 mb "s3://$BUCKET_NAME" --region $REGION
    aws s3api put-bucket-versioning \
        --bucket $BUCKET_NAME \
        --versioning-configuration Status=Enabled
    aws s3api put-bucket-encryption \
        --bucket $BUCKET_NAME \
        --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
    echo "✅ S3 bucket created: $BUCKET_NAME"
else
    echo "ℹ️  S3 bucket already exists: $BUCKET_NAME"
fi

# 2. Create DynamoDB table for state locking
echo ""
echo "🔒 Creating DynamoDB table for state locking..."
TABLE_NAME="menodao-terraform-locks"
if ! aws dynamodb describe-table --table-name $TABLE_NAME &> /dev/null; then
    aws dynamodb create-table \
        --table-name $TABLE_NAME \
        --attribute-definitions AttributeName=LockID,AttributeType=S \
        --key-schema AttributeName=LockID,KeyType=HASH \
        --billing-mode PAY_PER_REQUEST \
        --region $REGION
    echo "✅ DynamoDB table created: $TABLE_NAME"
else
    echo "ℹ️  DynamoDB table already exists: $TABLE_NAME"
fi

# 3. Create ECR repository
echo ""
echo "🐳 Creating ECR repository..."
ECR_REPO="menodao-backend"
if ! aws ecr describe-repositories --repository-names $ECR_REPO &> /dev/null; then
    aws ecr create-repository \
        --repository-name $ECR_REPO \
        --image-scanning-configuration scanOnPush=true \
        --region $REGION
    echo "✅ ECR repository created: $ECR_REPO"
else
    echo "ℹ️  ECR repository already exists: $ECR_REPO"
fi

# 4. Create IAM user for GitHub Actions
echo ""
echo "👤 Creating IAM user for GitHub Actions..."
IAM_USER="github-actions-menodao"
if ! aws iam get-user --user-name $IAM_USER &> /dev/null; then
    aws iam create-user --user-name $IAM_USER
    
    # Create policy
    cat > /tmp/github-actions-policy.json <<EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "ecr:GetAuthorizationToken",
                "ecr:BatchCheckLayerAvailability",
                "ecr:GetDownloadUrlForLayer",
                "ecr:BatchGetImage",
                "ecr:PutImage",
                "ecr:InitiateLayerUpload",
                "ecr:UploadLayerPart",
                "ecr:CompleteLayerUpload"
            ],
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "ecs:UpdateService",
                "ecs:DescribeServices",
                "ecs:DescribeTaskDefinition",
                "ecs:RegisterTaskDefinition",
                "ecs:RunTask"
            ],
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "iam:PassRole"
            ],
            "Resource": "arn:aws:iam::$ACCOUNT_ID:role/menodao-*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "amplify:StartJob",
                "amplify:GetJob"
            ],
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "secretsmanager:GetSecretValue"
            ],
            "Resource": "arn:aws:secretsmanager:$REGION:$ACCOUNT_ID:secret:menodao/*"
        }
    ]
}
EOF
    
    aws iam put-user-policy \
        --user-name $IAM_USER \
        --policy-name MenoDAODeployment \
        --policy-document file:///tmp/github-actions-policy.json
    
    # Create access key
    echo ""
    echo "🔑 Creating access keys..."
    aws iam create-access-key --user-name $IAM_USER
    echo ""
    echo "⚠️  IMPORTANT: Save the above access key credentials!"
    echo "   Add them to GitHub Secrets as AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY"
else
    echo "ℹ️  IAM user already exists: $IAM_USER"
fi

# 5. Verify Route 53 zone
echo ""
echo "🌐 Verifying Route 53 zone..."
if aws route53 list-hosted-zones-by-name --dns-name "menodao.org" --query "HostedZones[?Name=='menodao.org.']" --output text | grep -q "menodao.org"; then
    echo "✅ Route 53 zone found: menodao.org"
else
    echo "⚠️  Route 53 zone not found for menodao.org"
    echo "   Please create it manually in AWS Console"
fi

echo ""
echo "===================================="
echo "✅ Bootstrap complete!"
echo ""
echo "Next steps:"
echo "1. Save the IAM credentials to GitHub Secrets"
echo "2. Run: cd infrastructure/terraform && terraform init"
echo "3. Run: terraform workspace new staging"
echo "4. Run: terraform apply -var-file=staging.tfvars"
echo ""

#!/bin/bash
set -e

# MenoDAO ECS Cluster Provisioning Script
# Creates a single cluster named 'menodao' that hosts both dev and prod services

echo "🚀 MenoDAO ECS Cluster Provisioning"
echo "===================================="

# Configuration
REGION="${AWS_REGION:-us-east-1}"

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

echo "📍 AWS Account: $ACCOUNT_ID"
echo "📍 Region: $REGION"
echo ""

# Provision clusters
for ENV in "dev" "production"; do
    CLUSTER_NAME="menodao-${ENV}"
    echo "🏗️  Processing cluster: $CLUSTER_NAME"
    
    # Check if cluster already exists
    if aws ecs describe-clusters --clusters $CLUSTER_NAME --region $REGION --query "clusters[?status=='ACTIVE']" --output text | grep -q $CLUSTER_NAME; then
        echo "ℹ️  ECS cluster '$CLUSTER_NAME' already exists"
    else
        echo "📦 Creating ECS cluster..."
        aws ecs create-cluster \
            --cluster-name $CLUSTER_NAME \
            --capacity-providers FARGATE FARGATE_SPOT \
            --default-capacity-provider-strategy capacityProvider=FARGATE,weight=1,base=1 \
            --settings name=containerInsights,value=enabled \
            --configuration executeCommandConfiguration={logging=DEFAULT} \
            --region $REGION
        echo "✅ ECS cluster created: $CLUSTER_NAME"
    fi

    # Create CloudWatch log groups
    LOG_GROUP="/ecs/menodao-${ENV}"
    if aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP" --region $REGION --query "logGroups[?logGroupName=='$LOG_GROUP']" --output text | grep -q "$LOG_GROUP"; then
        echo "ℹ️  Log group already exists: $LOG_GROUP"
    else
        aws logs create-log-group --log-group-name "$LOG_GROUP" --region $REGION
        RETENTION=$([[ "$ENV" == "production" ]] && echo 30 || echo 7)
        aws logs put-retention-policy --log-group-name "$LOG_GROUP" --retention-in-days $RETENTION --region $REGION
        echo "✅ Log group created: $LOG_GROUP (retention: ${RETENTION} days)"
    fi
done

# Create IAM roles for ECS task execution
echo ""
echo "👤 Setting up IAM roles..."

EXECUTION_ROLE_NAME="menodao-ecs-execution"
TASK_ROLE_NAME="menodao-ecs-task"

# Trust policy for ECS tasks
cat > /tmp/ecs-trust-policy.json <<EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "Service": "ecs-tasks.amazonaws.com"
            },
            "Action": "sts:AssumeRole"
        }
    ]
}
EOF

# Create execution role if not exists
if ! aws iam get-role --role-name $EXECUTION_ROLE_NAME &> /dev/null; then
    aws iam create-role \
        --role-name $EXECUTION_ROLE_NAME \
        --assume-role-policy-document file:///tmp/ecs-trust-policy.json
    
    aws iam attach-role-policy \
        --role-name $EXECUTION_ROLE_NAME \
        --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
    
    echo "✅ Created IAM role: $EXECUTION_ROLE_NAME"
else
    echo "ℹ️  IAM role already exists: $EXECUTION_ROLE_NAME"
fi

# Create task role if not exists
if ! aws iam get-role --role-name $TASK_ROLE_NAME &> /dev/null; then
    aws iam create-role \
        --role-name $TASK_ROLE_NAME \
        --assume-role-policy-document file:///tmp/ecs-trust-policy.json
    
    echo "✅ Created IAM role: $TASK_ROLE_NAME"
else
    echo "ℹ️  IAM role already exists: $TASK_ROLE_NAME"
fi

# Add secrets access policy to execution role
cat > /tmp/secrets-policy.json <<EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "secretsmanager:GetSecretValue"
            ],
            "Resource": [
                "arn:aws:secretsmanager:${REGION}:${ACCOUNT_ID}:secret:menodao/*"
            ]
        }
    ]
}
EOF

aws iam put-role-policy \
    --role-name $EXECUTION_ROLE_NAME \
    --policy-name SecretsManagerAccess \
    --policy-document file:///tmp/secrets-policy.json

echo "✅ Updated execution role with secrets access"

# Cleanup temp files
rm -f /tmp/ecs-trust-policy.json /tmp/secrets-policy.json

echo ""
echo "===================================="
echo "✅ Cluster provisioning complete!"
echo ""
echo "Cluster: $CLUSTER_NAME"
echo "Region: $REGION"
echo ""
echo "Next steps:"
echo "1. Deploy services using: ./deploy-service.sh <dev|prod>"
echo "2. Ensure VPC, subnets, and security groups are configured"
echo "3. Create secrets in AWS Secrets Manager: menodao/dev/app and menodao/prod/app"
echo ""

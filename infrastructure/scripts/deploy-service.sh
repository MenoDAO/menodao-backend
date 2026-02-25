#!/bin/bash
set -e

# MenoDAO ECS Service Deployment Script
# Deploys menodao-api (prod) or menodao-api-dev service to the menodao cluster

usage() {
    echo "Usage: $0 <environment> [options]"
    echo ""
    echo "Environments:"
    echo "  dev   - Deploy menodao-api-dev service"
    echo "  prod  - Deploy menodao-api service"
    echo ""
    echo "Options:"
    echo "  --image <tag>     Docker image tag (default: latest for env)"
    echo "  --force           Force new deployment even if no changes"
    echo "  --scale <count>   Desired count of tasks"
    echo ""
    echo "Examples:"
    echo "  $0 dev"
    echo "  $0 prod --image abc123"
    echo "  $0 dev --scale 2 --force"
    exit 1
}

# Parse arguments
ENV=""
IMAGE_TAG=""
FORCE=false
SCALE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        dev|prod)
            ENV="$1"
            shift
            ;;
        --image)
            IMAGE_TAG="$2"
            shift 2
            ;;
        --force)
            FORCE=true
            shift
            ;;
        --scale)
            SCALE="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Unknown option: $1"
            usage
            ;;
    esac
done

if [ -z "$ENV" ]; then
    echo "❌ Environment is required"
    usage
fi

# Configuration
REGION="${AWS_REGION:-us-east-1}"
ECR_REPOSITORY="menodao-backend"

if [ "$ENV" == "prod" ]; then
    CLUSTER_NAME="menodao-production"
    SERVICE_NAME="menodao-backend-production"
    TASK_FAMILY="menodao-backend-production"
    DEFAULT_TAG="prod-latest"
    CPU="512"
    MEMORY="1024"
    DESIRED_COUNT="${SCALE:-2}"
    LOG_GROUP="/ecs/menodao-production"
    SECRETS_ARN_NAME="menodao/production/app"
else
    CLUSTER_NAME="menodao-dev"
    SERVICE_NAME="menodao-backend-dev"
    TASK_FAMILY="menodao-backend-dev"
    DEFAULT_TAG="dev-latest"
    CPU="256"
    MEMORY="512"
    DESIRED_COUNT="${SCALE:-1}"
    LOG_GROUP="/ecs/menodao-dev"
    SECRETS_ARN_NAME="menodao/dev/app"
fi

IMAGE_TAG="${IMAGE_TAG:-$DEFAULT_TAG}"

echo "🚀 MenoDAO Service Deployment"
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
ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
IMAGE_URI="${ECR_REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG}"

echo "📍 Environment: $ENV"
echo "📍 Cluster: $CLUSTER_NAME"
echo "📍 Service: $SERVICE_NAME"
echo "📍 Image: $IMAGE_URI"
echo "📍 Desired Count: $DESIRED_COUNT"
echo ""

# Get execution role ARN
EXECUTION_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/menodao-ecs-execution-role"
TASK_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/menodao-ecs-task-role"

# Get secrets ARN
SECRETS_ARN="arn:aws:secretsmanager:${REGION}:${ACCOUNT_ID}:secret:${SECRETS_ARN_NAME}"

# Determine NODE_ENV
NODE_ENV_VAL="development"
if [ "$ENV" == "prod" ]; then
    NODE_ENV_VAL="production"
fi

# Create task definition
echo "📝 Creating task definition..."

cat > /tmp/task-definition.json <<EOF
{
    "family": "${TASK_FAMILY}",
    "networkMode": "awsvpc",
    "requiresCompatibilities": ["FARGATE"],
    "cpu": "${CPU}",
    "memory": "${MEMORY}",
    "executionRoleArn": "${EXECUTION_ROLE_ARN}",
    "taskRoleArn": "${TASK_ROLE_ARN}",
    "containerDefinitions": [
        {
            "name": "menodao-backend",
            "image": "${IMAGE_URI}",
            "essential": true,
            "portMappings": [
                {
                    "containerPort": 3000,
                    "hostPort": 3000,
                    "protocol": "tcp"
                }
            ],
            "environment": [
                {"name": "NODE_ENV", "value": "${NODE_ENV_VAL}"},
                {"name": "PORT", "value": "3000"}
            ],
            "secrets": [
                {"name": "DATABASE_URL", "valueFrom": "${SECRETS_ARN}:DATABASE_URL::"},
                {"name": "JWT_SECRET", "valueFrom": "${SECRETS_ARN}:JWT_SECRET::"},
                {"name": "POLYGON_RPC_URL", "valueFrom": "${SECRETS_ARN}:POLYGON_RPC_URL::"},
                {"name": "PRIVATE_KEY", "valueFrom": "${SECRETS_ARN}:PRIVATE_KEY::"},
                {"name": "SMS_PROVIDER_URL", "valueFrom": "${SECRETS_ARN}:SMS_PROVIDER_URL::"},
                {"name": "SMS_PROVIDER_API_KEY", "valueFrom": "${SECRETS_ARN}:SMS_PROVIDER_API_KEY::"},
                {"name": "SMS_PROVIDER_PARTNER_ID", "valueFrom": "${SECRETS_ARN}:SMS_PROVIDER_PARTNER_ID::"},
                {"name": "SMS_SENDER_ID", "valueFrom": "${SECRETS_ARN}:SMS_SENDER_ID::"},
                {"name": "SASAPAY_CLIENT_ID", "valueFrom": "${SECRETS_ARN}:SASAPAY_CLIENT_ID::"},
                {"name": "SASAPAY_CLIENT_SECRET", "valueFrom": "${SECRETS_ARN}:SASAPAY_CLIENT_SECRET::"},
                {"name": "SASAPAY_MERCHANT_CODE", "valueFrom": "${SECRETS_ARN}:SASAPAY_MERCHANT_CODE::"},
                {"name": "SASAPAY_BASE_URL", "valueFrom": "${SECRETS_ARN}:SASAPAY_BASE_URL::"},
                {"name": "SASAPAY_NETWORK_CODE", "valueFrom": "${SECRETS_ARN}:SASAPAY_NETWORK_CODE::"},
                {"name": "API_BASE_URL", "valueFrom": "${SECRETS_ARN}:API_BASE_URL::"},
                {"name": "API_BASE_URL_DEV", "valueFrom": "${SECRETS_ARN}:API_BASE_URL_DEV::"},
                {"name": "DB_HOST", "valueFrom": "${SECRETS_ARN}:DB_HOST::"},
                {"name": "DB_NAME", "valueFrom": "${SECRETS_ARN}:DB_NAME::"},
                {"name": "DB_USER", "valueFrom": "${SECRETS_ARN}:DB_USER::"},
                {"name": "DB_PASSWORD", "valueFrom": "${SECRETS_ARN}:DB_PASSWORD::"}
            ],
            "logConfiguration": {
                "logDriver": "awslogs",
                "options": {
                    "awslogs-group": "${LOG_GROUP}",
                    "awslogs-region": "${REGION}",
                    "awslogs-stream-prefix": "${ENV}"
                }
            },
            "healthCheck": {
                "command": ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1"],
                "interval": 30,
                "timeout": 5,
                "retries": 3,
                "startPeriod": 60
            }
        }
    ]
}
EOF


TASK_DEF_ARN=$(aws ecs register-task-definition \
    --cli-input-json file:///tmp/task-definition.json \
    --region $REGION \
    --query 'taskDefinition.taskDefinitionArn' \
    --output text)

echo "✅ Task definition registered: $TASK_DEF_ARN"

# Check if service exists
echo ""
echo "🔍 Checking service status..."

if aws ecs describe-services --cluster $CLUSTER_NAME --services $SERVICE_NAME --region $REGION --query "services[?status=='ACTIVE']" --output text | grep -q $SERVICE_NAME; then
    echo "ℹ️  Service exists, updating..."
    
    UPDATE_ARGS="--cluster $CLUSTER_NAME --service $SERVICE_NAME --task-definition $TASK_DEF_ARN --desired-count $DESIRED_COUNT --region $REGION"
    
    if [ "$FORCE" = true ]; then
        UPDATE_ARGS="$UPDATE_ARGS --force-new-deployment"
    fi
    
    aws ecs update-service $UPDATE_ARGS
    
    echo "✅ Service updated: $SERVICE_NAME"
else
    echo "📦 Creating new service..."
    
    # Get VPC configuration from environment or secrets
    # These should be set as environment variables or retrieved from AWS
    SUBNET_IDS="${PRIVATE_SUBNET_IDS:-}"
    SECURITY_GROUP_ID="${SECURITY_GROUP_ID:-}"
    TARGET_GROUP_ARN="${TARGET_GROUP_ARN:-}"
    
    if [ -z "$SUBNET_IDS" ] || [ -z "$SECURITY_GROUP_ID" ]; then
        echo "❌ Network configuration required. Set PRIVATE_SUBNET_IDS and SECURITY_GROUP_ID environment variables."
        echo ""
        echo "Example:"
        echo "  export PRIVATE_SUBNET_IDS='subnet-abc123,subnet-def456'"
        echo "  export SECURITY_GROUP_ID='sg-xyz789'"
        echo "  export TARGET_GROUP_ARN='arn:aws:elasticloadbalancing:...'"
        exit 1
    fi
    
    # Build the service creation command
    SERVICE_CREATE_ARGS="--cluster $CLUSTER_NAME \
        --service-name $SERVICE_NAME \
        --task-definition $TASK_DEF_ARN \
        --desired-count $DESIRED_COUNT \
        --launch-type FARGATE \
        --network-configuration awsvpcConfiguration={subnets=[$SUBNET_IDS],securityGroups=[$SECURITY_GROUP_ID],assignPublicIp=DISABLED} \
        --deployment-configuration maximumPercent=200,minimumHealthyPercent=100,deploymentCircuitBreaker={enable=true,rollback=true} \
        --region $REGION"
    
    # Add load balancer if target group is specified
    if [ -n "$TARGET_GROUP_ARN" ]; then
        SERVICE_CREATE_ARGS="$SERVICE_CREATE_ARGS --load-balancers targetGroupArn=$TARGET_GROUP_ARN,containerName=menodao-backend,containerPort=3001"
    fi
    
    aws ecs create-service $SERVICE_CREATE_ARGS
    
    echo "✅ Service created: $SERVICE_NAME"
fi

# Wait for service stability
echo ""
echo "⏳ Waiting for service to stabilize..."

aws ecs wait services-stable \
    --cluster $CLUSTER_NAME \
    --services $SERVICE_NAME \
    --region $REGION

echo "✅ Service is stable!"

# Cleanup
rm -f /tmp/task-definition.json

echo ""
echo "===================================="
echo "✅ Deployment complete!"
echo ""
echo "Service: $SERVICE_NAME"
echo "Cluster: $CLUSTER_NAME"
echo "Task Definition: $TASK_DEF_ARN"
echo ""
echo "To check service status:"
echo "  aws ecs describe-services --cluster $CLUSTER_NAME --services $SERVICE_NAME --region $REGION"
echo ""

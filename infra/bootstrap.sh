#!/bin/bash
set -euo pipefail
# CloudFormation substitutes only the named deployment parameters below.
dnf install -y docker jq
command -v aws >/dev/null || dnf install -y awscli-2
systemctl enable --now docker
TOKEN=$(curl -fsS -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 300' http://169.254.169.254/latest/api/token)
INSTANCE_ID=$(curl -fsS -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)
signal_exit() {
  CODE=$?
  STATUS=FAILURE
  if [ "$CODE" = 0 ]; then STATUS=SUCCESS; fi
  aws cloudformation signal-resource --region '${AWS::Region}' --stack-name '${AWS::StackName}' --logical-resource-id Fleet --unique-id "$INSTANCE_ID" --status "$STATUS" || true
}
trap signal_exit EXIT
install -d -m 700 /etc/airbnb
umask 077
aws secretsmanager get-secret-value --region '${AWS::Region}' --secret-id '${AppSecretArn}' --query SecretString --output text > /run/airbnb-secret.json
jq -e '(.MONGODB_URI|type=="string") and (.ADMIN_API_TOKEN|type=="string" and length>=32) and (.CORS_ORIGIN|type=="string") and ([.MONGODB_URI,.ADMIN_API_TOKEN,.CORS_ORIGIN]|all(test("[\r\n]")|not))' /run/airbnb-secret.json >/dev/null
jq -r 'with_entries(select(.key=="MONGODB_URI" or .key=="ADMIN_API_TOKEN" or .key=="CORS_ORIGIN")) | to_entries[] | "\(.key)=\(.value)"' /run/airbnb-secret.json > /etc/airbnb/backend.env
printf '\nNODE_ENV=production\nPORT=5000\nMETRICS_ENABLED=true\nMETRICS_ENVIRONMENT=${AWS::StackName}\nLOAD_TEST_DATA_ENABLED=${EnableLoadTesting}\n' >> /etc/airbnb/backend.env
rm -f /run/airbnb-secret.json
for IMAGE in '${BackendImage}' '${FrontendImage}'; do
  REGISTRY=$(printf '%s' "$IMAGE" | cut -d/ -f1)
  aws ecr get-login-password --region '${AWS::Region}' | docker login --username AWS --password-stdin "$REGISTRY"
  docker pull "$IMAGE"
done
docker network create airbnb
docker run -d --name backend --network airbnb --restart unless-stopped --init --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges --env-file /etc/airbnb/backend.env --log-driver awslogs --log-opt awslogs-region='${AWS::Region}' --log-opt awslogs-group='${ApplicationLogs}' --log-opt awslogs-stream="$INSTANCE_ID-api" '${BackendImage}'
docker run -d --name frontend --network airbnb --restart unless-stopped --init --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges -p 8080:8080 --log-driver awslogs --log-opt awslogs-region='${AWS::Region}' --log-opt awslogs-group='${ApplicationLogs}' --log-opt awslogs-stream="$INSTANCE_ID-web" '${FrontendImage}'
for attempt in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8080/health >/dev/null; then exit 0; fi
  sleep 5
done
exit 1

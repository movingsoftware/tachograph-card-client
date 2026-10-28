#!/usr/bin/env bash
# Runs a shell command in a one-off task of the deployed Platform service and fails when it fails.
#
#   PLATFORM_ECS_CLUSTER=... PLATFORM_ECS_SERVICE=... AWS_REGION=... platform-artisan.sh '<command>' [NAME=VALUE ...]
#
# Each NAME=VALUE becomes an environment variable of the task, so untrusted text reaches the command as "$NAME", never inline.
set -euo pipefail

command="${1:?Give the command to run.}"
shift
: "${PLATFORM_ECS_CLUSTER:?Set PLATFORM_ECS_CLUSTER.}" "${PLATFORM_ECS_SERVICE:?Set PLATFORM_ECS_SERVICE.}" "${AWS_REGION:?Set AWS_REGION.}"

environment='[{"name":"QUEUE_AUTOSCALE_AUTOSTART","value":"false"},{"name":"QUEUE_AUTOSCALE_ENABLED","value":"false"}]'
for pair in "$@"; do
  [[ "$pair" =~ ^[A-Z_][A-Z0-9_]*= ]] || { echo "Task environment '${pair%%=*}' is not NAME=VALUE." >&2; exit 1; }
  environment="$(jq -c --arg name "${pair%%=*}" --arg value "${pair#*=}" '. + [{name: $name, value: $value}]' <<<"$environment")"
done

service="$(aws ecs describe-services --cluster "$PLATFORM_ECS_CLUSTER" --services "$PLATFORM_ECS_SERVICE" --output json \
  | jq -ce '.services | select(length == 1) | .[0] | select(.status == "ACTIVE")')" \
  || { echo "The Platform service $PLATFORM_ECS_SERVICE is not active in $PLATFORM_ECS_CLUSTER." >&2; exit 1; }

# The task runs the service's own task definition, network and capacity, so it is the deployed Platform.
request="$(jq -c --arg cluster "$PLATFORM_ECS_CLUSTER" --arg command "$command" --argjson environment "$environment" '{
  cluster: $cluster,
  taskDefinition: .taskDefinition,
  count: 1,
  startedBy: "tcc-bundles",
  overrides: {containerOverrides: [{name: "app", command: ["/bin/sh", "-lc", $command], environment: $environment}]}
} + (if .networkConfiguration then {networkConfiguration: .networkConfiguration} else {} end)
  + (if (.capacityProviderStrategy // []) != [] then {capacityProviderStrategy: .capacityProviderStrategy} elif .launchType then {launchType: .launchType} else {} end)' <<<"$service")"

task="$(aws ecs run-task --cli-input-json "$request" --output json | jq -re 'select((.failures // []) == []) | .tasks[0].taskArn')" \
  || { echo "ECS refused the Platform task." >&2; exit 1; }
echo "Started $task"

aws ecs wait tasks-stopped --cluster "$PLATFORM_ECS_CLUSTER" --tasks "$task"
exit_code="$(aws ecs describe-tasks --cluster "$PLATFORM_ECS_CLUSTER" --tasks "$task" --output json \
  | jq -r '.tasks[0].containers[] | select(.name == "app") | .exitCode // "none"')"
if [ "$exit_code" != 0 ]; then
  echo "The Platform task $task stopped with exit code $exit_code; its log is in the service's log group." >&2
  exit 1
fi
echo "The Platform task $task succeeded."

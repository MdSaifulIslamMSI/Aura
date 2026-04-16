param(
    [string]$StackPrefix = "aura",
    [string]$AwsRegion = "ap-south-1",
    [string]$AwsProfile = "",
    [string]$AccountId = "",
    [string]$InstanceId = "",
    [string]$InstanceTagName = "aura-backend",
    [decimal]$MonthlyBudgetUsd = 14,
    [string]$PlanExpirationDate = "",
    [string]$BudgetName = "",
    [string]$TopicName = "",
    [string]$BudgetExecutionRoleName = "",
    [string]$ExpirationStopRoleName = "",
    [string]$ExpirationScheduleName = ""
)

$ErrorActionPreference = "Stop"

function Require-Command {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found on PATH."
    }
}

function Ensure-Role {
    param(
        [string]$RoleName,
        [string]$TrustPolicyJson,
        [string[]]$ManagedPolicyArns = @(),
        [string]$InlinePolicyJson = "",
        [string]$InlinePolicyName = ""
    )

    $trustPolicyFile = Join-Path $env:TEMP "$RoleName-trust.json"
    $TrustPolicyJson | Set-Content -LiteralPath $trustPolicyFile -Encoding ascii

    try {
        aws iam get-role --role-name $RoleName 1>$null 2>$null
        $roleExists = $true
    } catch {
        $roleExists = $false
    }

    if (-not $roleExists) {
        aws iam create-role `
            --role-name $RoleName `
            --assume-role-policy-document "file://$trustPolicyFile" | Out-Null
        Start-Sleep -Seconds 5
    }

    foreach ($policyArn in $ManagedPolicyArns) {
        aws iam attach-role-policy --role-name $RoleName --policy-arn $policyArn | Out-Null
    }

    if (-not [string]::IsNullOrWhiteSpace($InlinePolicyJson) -and -not [string]::IsNullOrWhiteSpace($InlinePolicyName)) {
        $policyFile = Join-Path $env:TEMP "$RoleName-inline.json"
        $InlinePolicyJson | Set-Content -LiteralPath $policyFile -Encoding ascii
        aws iam put-role-policy `
            --role-name $RoleName `
            --policy-name $InlinePolicyName `
            --policy-document "file://$policyFile" | Out-Null
    }
}

function Ensure-SnsTopic {
    param([string]$ResolvedTopicName)

    return aws sns create-topic --name $ResolvedTopicName --query "TopicArn" --output text
}

function Ensure-Budget {
    param(
        [string]$ResolvedAccountId,
        [string]$ResolvedBudgetName,
        [decimal]$ResolvedMonthlyBudgetUsd,
        [string]$TopicArn
    )

    $budget = @{
        BudgetName = $ResolvedBudgetName
        BudgetLimit = @{
            Amount = $ResolvedMonthlyBudgetUsd.ToString("0.##")
            Unit = "USD"
        }
        BudgetType = "COST"
        TimeUnit = "MONTHLY"
        CostTypes = @{
            IncludeTax = $true
            IncludeSubscription = $true
            UseBlended = $false
            IncludeRefund = $true
            IncludeCredit = $false
            IncludeUpfront = $true
            IncludeRecurring = $true
            IncludeOtherSubscription = $true
            IncludeSupport = $true
            IncludeDiscount = $false
            UseAmortized = $false
        }
    } | ConvertTo-Json -Depth 8

    $notifications = @(
        @{
            Notification = @{
                NotificationType = "FORECASTED"
                ComparisonOperator = "GREATER_THAN"
                Threshold = 85
                ThresholdType = "PERCENTAGE"
            }
            Subscribers = @(
                @{
                    SubscriptionType = "SNS"
                    Address = $TopicArn
                }
            )
        },
        @{
            Notification = @{
                NotificationType = "ACTUAL"
                ComparisonOperator = "GREATER_THAN"
                Threshold = 100
                ThresholdType = "PERCENTAGE"
            }
            Subscribers = @(
                @{
                    SubscriptionType = "SNS"
                    Address = $TopicArn
                }
            )
        }
    ) | ConvertTo-Json -Depth 8

    $budgetFile = Join-Path $env:TEMP "$ResolvedBudgetName-budget.json"
    $notificationsFile = Join-Path $env:TEMP "$ResolvedBudgetName-notifications.json"
    $budget | Set-Content -LiteralPath $budgetFile -Encoding ascii
    $notifications | Set-Content -LiteralPath $notificationsFile -Encoding ascii

    try {
        aws budgets describe-budget --account-id $ResolvedAccountId --budget-name $ResolvedBudgetName --region us-east-1 1>$null 2>$null
        $budgetExists = $true
    } catch {
        $budgetExists = $false
    }

    if ($budgetExists) {
        aws budgets update-budget `
            --account-id $ResolvedAccountId `
            --new-budget "file://$budgetFile" `
            --region us-east-1 | Out-Null
    } else {
        aws budgets create-budget `
            --account-id $ResolvedAccountId `
            --budget "file://$budgetFile" `
            --notifications-with-subscribers "file://$notificationsFile" `
            --region us-east-1 | Out-Null
    }
}

function Ensure-BudgetAction {
    param(
        [string]$ResolvedAccountId,
        [string]$ResolvedBudgetName,
        [string]$ResolvedInstanceId,
        [string]$ResolvedRoleArn,
        [decimal]$ResolvedMonthlyBudgetUsd,
        [string]$TopicArn,
        [string]$Region
    )

    $actionDefinition = @{
        SsmActionDefinition = @{
            ActionSubType = "STOP_EC2_INSTANCES"
            Region = $Region
            InstanceIds = @($ResolvedInstanceId)
        }
    } | ConvertTo-Json -Depth 6 -Compress

    $subscribers = ConvertTo-Json -InputObject @(
        @{
            SubscriptionType = "SNS"
            Address = $TopicArn
        }
    ) -Depth 4 -Compress

    $actionDefinitionFile = Join-Path $env:TEMP "$ResolvedBudgetName-action-definition.json"
    $subscribersFile = Join-Path $env:TEMP "$ResolvedBudgetName-action-subscribers.json"
    $actionDefinition | Set-Content -LiteralPath $actionDefinitionFile -Encoding ascii
    $subscribers | Set-Content -LiteralPath $subscribersFile -Encoding ascii

    $existingActionsJson = aws budgets describe-budget-actions-for-budget `
        --account-id $ResolvedAccountId `
        --budget-name $ResolvedBudgetName `
        --region us-east-1
    $existingActions = $existingActionsJson | ConvertFrom-Json
    $existingActionId = $existingActions.Actions | Where-Object {
        $_.ActionType -eq "RUN_SSM_DOCUMENTS" -and
        $_.Definition.SsmActionDefinition.ActionSubType -eq "STOP_EC2_INSTANCES"
    } | Select-Object -ExpandProperty ActionId -First 1

    if ([string]::IsNullOrWhiteSpace($existingActionId)) {
        aws budgets create-budget-action `
            --account-id $ResolvedAccountId `
            --budget-name $ResolvedBudgetName `
            --notification-type ACTUAL `
            --action-type RUN_SSM_DOCUMENTS `
            --action-threshold "ActionThresholdValue=$($ResolvedMonthlyBudgetUsd.ToString("0.##")),ActionThresholdType=ABSOLUTE_VALUE" `
            --definition "file://$actionDefinitionFile" `
            --execution-role-arn $ResolvedRoleArn `
            --approval-model AUTOMATIC `
            --subscribers "file://$subscribersFile" `
            --region us-east-1 | Out-Null
    } else {
        aws budgets update-budget-action `
            --account-id $ResolvedAccountId `
            --budget-name $ResolvedBudgetName `
            --action-id $existingActionId `
            --notification-type ACTUAL `
            --action-threshold "ActionThresholdValue=$($ResolvedMonthlyBudgetUsd.ToString("0.##")),ActionThresholdType=ABSOLUTE_VALUE" `
            --definition "file://$actionDefinitionFile" `
            --execution-role-arn $ResolvedRoleArn `
            --approval-model AUTOMATIC `
            --subscribers "file://$subscribersFile" `
            --region us-east-1 | Out-Null
    }
}

function Ensure-ExpirationSchedule {
    param(
        [string]$ResolvedScheduleName,
        [string]$ResolvedRoleArn,
        [string]$ResolvedInstanceId,
        [datetimeoffset]$ResolvedExpirationUtc
    )

    $formattedExpiration = $ResolvedExpirationUtc.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss")
    $scheduleInput = @{
        InstanceIds = @($ResolvedInstanceId)
    } | ConvertTo-Json -Compress
    $target = @{
        Arn = "arn:aws:scheduler:::aws-sdk:ec2:stopInstances"
        RoleArn = $ResolvedRoleArn
        Input = $scheduleInput
    } | ConvertTo-Json -Depth 6 -Compress
    $targetFile = Join-Path $env:TEMP "$ResolvedScheduleName-target.json"
    $target | Set-Content -LiteralPath $targetFile -Encoding ascii

    try {
        aws scheduler get-schedule --name $ResolvedScheduleName --group-name default --region $AwsRegion 1>$null 2>$null
        $scheduleExists = $true
    } catch {
        $scheduleExists = $false
    }

    if ($scheduleExists) {
        aws scheduler update-schedule `
            --name $ResolvedScheduleName `
            --group-name default `
            --schedule-expression "at($formattedExpiration)" `
            --flexible-time-window "Mode=OFF" `
            --target "file://$targetFile" `
            --action-after-completion DELETE `
            --state ENABLED `
            --region $AwsRegion | Out-Null
    } else {
        aws scheduler create-schedule `
            --name $ResolvedScheduleName `
            --group-name default `
            --schedule-expression "at($formattedExpiration)" `
            --flexible-time-window "Mode=OFF" `
            --target "file://$targetFile" `
            --action-after-completion DELETE `
            --state ENABLED `
            --region $AwsRegion | Out-Null
    }
}

Require-Command -Name "aws"

if (-not [string]::IsNullOrWhiteSpace($AwsProfile)) {
    $env:AWS_PROFILE = $AwsProfile
}

$resolvedAccountId = if ([string]::IsNullOrWhiteSpace($AccountId)) {
    aws sts get-caller-identity --query "Account" --output text
} else {
    $AccountId
}

$resolvedInstanceId = if ([string]::IsNullOrWhiteSpace($InstanceId)) {
    aws ec2 describe-instances `
        --region $AwsRegion `
        --filters Name=tag:Name,Values=$InstanceTagName Name=instance-state-name,Values=pending,running,stopping,stopped `
        --query "Reservations | sort_by(@,&Instances[0].LaunchTime)[-1].Instances[0].InstanceId" `
        --output text
} else {
    $InstanceId
}

if ([string]::IsNullOrWhiteSpace($resolvedInstanceId) -or $resolvedInstanceId -eq "None") {
    throw "Could not resolve a backend instance. Pass -InstanceId or ensure the instance tag exists."
}

$resolvedPlanExpiration = if ([string]::IsNullOrWhiteSpace($PlanExpirationDate)) {
    aws freetier get-account-plan-state --region us-east-1 --query "accountPlanExpirationDate" --output text
} else {
    $PlanExpirationDate
}

if ([string]::IsNullOrWhiteSpace($resolvedPlanExpiration) -or $resolvedPlanExpiration -eq "None") {
    throw "Could not resolve the account plan expiration date."
}

$expirationUtc = [datetimeoffset]::Parse($resolvedPlanExpiration).ToUniversalTime()

$resolvedBudgetName = if ([string]::IsNullOrWhiteSpace($BudgetName)) { "$StackPrefix-backend-monthly-guardrail" } else { $BudgetName }
$resolvedTopicName = if ([string]::IsNullOrWhiteSpace($TopicName)) { "$StackPrefix-backend-guardrails" } else { $TopicName }
$resolvedBudgetExecutionRoleName = if ([string]::IsNullOrWhiteSpace($BudgetExecutionRoleName)) { "$StackPrefix-budgets-stop-ec2-role" } else { $BudgetExecutionRoleName }
$resolvedExpirationStopRoleName = if ([string]::IsNullOrWhiteSpace($ExpirationStopRoleName)) { "$StackPrefix-expiration-stop-ec2-role" } else { $ExpirationStopRoleName }
$resolvedScheduleName = if ([string]::IsNullOrWhiteSpace($ExpirationScheduleName)) { "$StackPrefix-free-plan-expiration-stop" } else { $ExpirationScheduleName }

$topicArn = Ensure-SnsTopic -ResolvedTopicName $resolvedTopicName

$budgetsTrustPolicy = @{
    Version = "2012-10-17"
    Statement = @(
        @{
            Effect = "Allow"
            Principal = @{
                Service = "budgets.amazonaws.com"
            }
            Action = "sts:AssumeRole"
        }
    )
} | ConvertTo-Json -Depth 6

Ensure-Role `
    -RoleName $resolvedBudgetExecutionRoleName `
    -TrustPolicyJson $budgetsTrustPolicy `
    -ManagedPolicyArns @("arn:aws:iam::aws:policy/AWSBudgetsActions_RolePolicyForResourceAdministrationWithSSM")

$budgetRoleArn = aws iam get-role --role-name $resolvedBudgetExecutionRoleName --query "Role.Arn" --output text

Ensure-Budget `
    -ResolvedAccountId $resolvedAccountId `
    -ResolvedBudgetName $resolvedBudgetName `
    -ResolvedMonthlyBudgetUsd $MonthlyBudgetUsd `
    -TopicArn $topicArn

Ensure-BudgetAction `
    -ResolvedAccountId $resolvedAccountId `
    -ResolvedBudgetName $resolvedBudgetName `
    -ResolvedInstanceId $resolvedInstanceId `
    -ResolvedRoleArn $budgetRoleArn `
    -ResolvedMonthlyBudgetUsd $MonthlyBudgetUsd `
    -TopicArn $topicArn `
    -Region $AwsRegion

$schedulerTrustPolicy = @{
    Version = "2012-10-17"
    Statement = @(
        @{
            Effect = "Allow"
            Principal = @{
                Service = "scheduler.amazonaws.com"
            }
            Action = "sts:AssumeRole"
        }
    )
} | ConvertTo-Json -Depth 6

$schedulerInlinePolicy = @{
    Version = "2012-10-17"
    Statement = @(
        @{
            Effect = "Allow"
            Action = @(
                "ec2:StopInstances"
            )
            Resource = "arn:aws:ec2:${AwsRegion}:${resolvedAccountId}:instance/${resolvedInstanceId}"
        }
    )
} | ConvertTo-Json -Depth 6

Ensure-Role `
    -RoleName $resolvedExpirationStopRoleName `
    -TrustPolicyJson $schedulerTrustPolicy `
    -InlinePolicyJson $schedulerInlinePolicy `
    -InlinePolicyName "$resolvedExpirationStopRoleName-inline"

$schedulerRoleArn = aws iam get-role --role-name $resolvedExpirationStopRoleName --query "Role.Arn" --output text

Ensure-ExpirationSchedule `
    -ResolvedScheduleName $resolvedScheduleName `
    -ResolvedRoleArn $schedulerRoleArn `
    -ResolvedInstanceId $resolvedInstanceId `
    -ResolvedExpirationUtc $expirationUtc

Write-Host "Configured monthly budget guardrail."
Write-Host "Budget: $resolvedBudgetName ($($MonthlyBudgetUsd.ToString("0.##")) USD/month)"
Write-Host "Budget action topic: $topicArn"
Write-Host "Expiration stop schedule: $resolvedScheduleName"
Write-Host "Free plan expiration (UTC): $($expirationUtc.ToString("u"))"

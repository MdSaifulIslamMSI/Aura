param(
    [string]$StackPrefix = "aura",
    [string]$AwsRegion = "ap-south-1",
    [string]$AwsProfile = "",
    [string]$VpcId = "",
    [string]$InstanceTagName = "aura-backend",
    [string]$ConfigBucketName = "",
    [string]$ConfigRoleName = "",
    [string]$ConfigRecorderName = "",
    [string]$ConfigDeliveryChannelName = "",
    [string]$FlowLogsRoleName = "",
    [string]$FlowLogsLogGroupName = "",
    [int]$FlowLogsRetentionDays = 30
)

$ErrorActionPreference = "Stop"

function Require-Command {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found on PATH."
    }
}

function Invoke-AwsChecked {
    & $script:AwsCliPath @args
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "AWS CLI command failed with exit code $exitCode."
    }
}

function Write-JsonTempFile {
    param(
        [string]$Name,
        [object]$Value,
        [int]$Depth = 8
    )

    $file = Join-Path $env:TEMP $Name
    $Value | ConvertTo-Json -Depth $Depth -Compress | Set-Content -LiteralPath $file -Encoding ascii
    return $file
}

function Ensure-Role {
    param(
        [string]$RoleName,
        [object]$TrustPolicy,
        [string[]]$ManagedPolicyArns = @(),
        [object]$InlinePolicy = $null,
        [string]$InlinePolicyName = ""
    )

    $trustPolicyFile = Write-JsonTempFile -Name "$RoleName-trust.json" -Value $TrustPolicy

    try {
        aws iam get-role --role-name $RoleName 1>$null 2>$null
        $roleExists = $true
    } catch {
        $roleExists = $false
    }

    if ($roleExists) {
        aws iam update-assume-role-policy `
            --role-name $RoleName `
            --policy-document "file://$trustPolicyFile" | Out-Null
    } else {
        aws iam create-role `
            --role-name $RoleName `
            --assume-role-policy-document "file://$trustPolicyFile" | Out-Null
        Start-Sleep -Seconds 5
    }

    foreach ($policyArn in $ManagedPolicyArns) {
        aws iam attach-role-policy --role-name $RoleName --policy-arn $policyArn | Out-Null
    }

    if ($null -ne $InlinePolicy -and -not [string]::IsNullOrWhiteSpace($InlinePolicyName)) {
        $inlinePolicyFile = Write-JsonTempFile -Name "$RoleName-inline.json" -Value $InlinePolicy
        aws iam put-role-policy `
            --role-name $RoleName `
            --policy-name $InlinePolicyName `
            --policy-document "file://$inlinePolicyFile" | Out-Null
    }

    return (aws iam get-role --role-name $RoleName | ConvertFrom-Json).Role.Arn
}

function Ensure-Bucket {
    param([string]$BucketName, [string]$Region)

    try {
        aws s3api head-bucket --bucket $BucketName 2>$null | Out-Null
        return
    } catch {
    }

    if ($Region -eq "us-east-1") {
        aws s3api create-bucket --bucket $BucketName | Out-Null
        return
    }

    aws s3api create-bucket `
        --bucket $BucketName `
        --region $Region `
        --create-bucket-configuration "LocationConstraint=$Region" | Out-Null
}

function Configure-PrivateBucket {
    param(
        [string]$BucketName,
        [string]$LifecycleFile = ""
    )

    $encryption = @{
        Rules = @(
            @{
                ApplyServerSideEncryptionByDefault = @{
                    SSEAlgorithm = "AES256"
                }
                BucketKeyEnabled = $true
            }
        )
    }
    $ownership = @{
        Rules = @(
            @{
                ObjectOwnership = "BucketOwnerEnforced"
            }
        )
    }

    $encryptionFile = Write-JsonTempFile -Name "$BucketName-encryption.json" -Value $encryption
    $ownershipFile = Write-JsonTempFile -Name "$BucketName-ownership.json" -Value $ownership

    aws s3api put-public-access-block `
        --bucket $BucketName `
        --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" | Out-Null
    aws s3api put-bucket-encryption `
        --bucket $BucketName `
        --server-side-encryption-configuration "file://$encryptionFile" | Out-Null
    aws s3api put-bucket-versioning `
        --bucket $BucketName `
        --versioning-configuration Status=Enabled | Out-Null
    aws s3api put-bucket-ownership-controls `
        --bucket $BucketName `
        --ownership-controls "file://$ownershipFile" | Out-Null

    if (-not [string]::IsNullOrWhiteSpace($LifecycleFile)) {
        aws s3api put-bucket-lifecycle-configuration `
            --bucket $BucketName `
            --lifecycle-configuration "file://$LifecycleFile" | Out-Null
    }
}

function Resolve-BackendVpcId {
    param([string]$ExplicitVpcId, [string]$Region, [string]$BackendInstanceTagName)

    if (-not [string]::IsNullOrWhiteSpace($ExplicitVpcId)) {
        return $ExplicitVpcId.Trim()
    }

    $resolvedVpcId = aws ec2 describe-instances `
        --region $Region `
        --filters Name=tag:Name,Values=$BackendInstanceTagName Name=instance-state-name,Values=pending,running,stopping,stopped `
        --query "Reservations | sort_by(@,&Instances[0].LaunchTime)[-1].Instances[0].VpcId" `
        --output text

    if ([string]::IsNullOrWhiteSpace($resolvedVpcId) -or $resolvedVpcId -eq "None") {
        throw "Could not resolve backend VPC. Pass -VpcId or ensure the backend instance tag exists."
    }

    return $resolvedVpcId
}

function Ensure-GuardDuty {
    param([string]$Region)

    $detectorsOutput = & $script:AwsCliPath guardduty list-detectors --region $Region 2>&1
    if ($LASTEXITCODE -ne 0) {
        $message = ($detectorsOutput | Out-String).Trim()
        if ($message -match 'SubscriptionRequiredException') {
            Write-Warning "GuardDuty could not be enabled because the account is not subscribed for GuardDuty in $Region."
            return $false
        }
        throw "GuardDuty detector lookup failed: $message"
    }

    $detectorsJson = $detectorsOutput | Out-String
    $detectors = $detectorsJson | ConvertFrom-Json
    $detectorId = $detectors.DetectorIds | Select-Object -First 1

    if ([string]::IsNullOrWhiteSpace($detectorId)) {
        $detectorOutput = & $script:AwsCliPath guardduty create-detector `
            --region $Region `
            --enable `
            --finding-publishing-frequency FIFTEEN_MINUTES `
            --query DetectorId `
            --output text 2>&1
        if ($LASTEXITCODE -ne 0) {
            $message = ($detectorOutput | Out-String).Trim()
            if ($message -match 'SubscriptionRequiredException') {
                Write-Warning "GuardDuty could not be enabled because the account is not subscribed for GuardDuty in $Region."
                return $false
            }
            throw "GuardDuty detector creation failed: $message"
        }

        $detectorId = ($detectorOutput | Out-String).Trim()
        Write-Host "GuardDuty detector created: $detectorId"
        return $true
    }

    $updateOutput = aws guardduty update-detector `
        --region $Region `
        --detector-id $detectorId `
        --enable 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "GuardDuty detector update failed: $(($updateOutput | Out-String).Trim())"
    }

    Write-Host "GuardDuty detector enabled: $detectorId"
    return $true
}

function Ensure-ConfigRecorder {
    param(
        [string]$Region,
        [string]$AccountId,
        [string]$BucketName,
        [string]$RoleName,
        [string]$RecorderName,
        [string]$DeliveryChannelName
    )

    Ensure-Bucket -BucketName $BucketName -Region $Region

    $configLifecycle = @{
        Rules = @(
            @{
                ID = "ExpireConfigSnapshots"
                Status = "Enabled"
                Filter = @{
                    Prefix = "AWSLogs/"
                }
                Expiration = @{
                    Days = 365
                }
                NoncurrentVersionExpiration = @{
                    NoncurrentDays = 30
                }
                AbortIncompleteMultipartUpload = @{
                    DaysAfterInitiation = 1
                }
            }
        )
    }
    $configLifecycleFile = Write-JsonTempFile -Name "$BucketName-lifecycle.json" -Value $configLifecycle
    Configure-PrivateBucket -BucketName $BucketName -LifecycleFile $configLifecycleFile

    $bucketPolicy = @{
        Version = "2012-10-17"
        Statement = @(
            @{
                Sid = "AWSConfigBucketPermissionsCheck"
                Effect = "Allow"
                Principal = @{
                    Service = "config.amazonaws.com"
                }
                Action = "s3:GetBucketAcl"
                Resource = "arn:aws:s3:::$BucketName"
                Condition = @{
                    StringEquals = @{
                        "AWS:SourceAccount" = $AccountId
                    }
                }
            },
            @{
                Sid = "AWSConfigBucketDelivery"
                Effect = "Allow"
                Principal = @{
                    Service = "config.amazonaws.com"
                }
                Action = "s3:PutObject"
                Resource = "arn:aws:s3:::$BucketName/AWSLogs/$AccountId/Config/*"
                Condition = @{
                    StringEquals = @{
                        "s3:x-amz-acl" = "bucket-owner-full-control"
                        "AWS:SourceAccount" = $AccountId
                    }
                }
            }
        )
    }
    $bucketPolicyFile = Write-JsonTempFile -Name "$BucketName-policy.json" -Value $bucketPolicy -Depth 10
    aws s3api put-bucket-policy --bucket $BucketName --policy "file://$bucketPolicyFile" | Out-Null

    $configTrustPolicy = @{
        Version = "2012-10-17"
        Statement = @(
            @{
                Effect = "Allow"
                Principal = @{
                    Service = "config.amazonaws.com"
                }
                Action = "sts:AssumeRole"
            }
        )
    }
    $configRoleArn = Ensure-Role `
        -RoleName $RoleName `
        -TrustPolicy $configTrustPolicy `
        -ManagedPolicyArns @("arn:aws:iam::aws:policy/service-role/AWS_ConfigRole")

    $recorder = @{
        name = $RecorderName
        roleARN = $configRoleArn
    }
    $recordingGroup = @{
        allSupported = $true
        includeGlobalResourceTypes = $true
    }
    $deliveryChannel = @{
        name = $DeliveryChannelName
        s3BucketName = $BucketName
    }
    $recorderFile = Write-JsonTempFile -Name "$RecorderName-recorder.json" -Value $recorder
    $recordingGroupFile = Write-JsonTempFile -Name "$RecorderName-recording-group.json" -Value $recordingGroup
    $deliveryChannelFile = Write-JsonTempFile -Name "$DeliveryChannelName-delivery-channel.json" -Value $deliveryChannel

    aws configservice put-configuration-recorder `
        --region $Region `
        --configuration-recorder "file://$recorderFile" `
        --recording-group "file://$recordingGroupFile" | Out-Null
    aws configservice put-delivery-channel `
        --region $Region `
        --delivery-channel "file://$deliveryChannelFile" | Out-Null
    aws configservice start-configuration-recorder `
        --region $Region `
        --configuration-recorder-name $RecorderName | Out-Null

    Write-Host "AWS Config recorder enabled: $RecorderName"
}

function Ensure-VpcFlowLogs {
    param(
        [string]$Region,
        [string]$AccountId,
        [string]$ResolvedVpcId,
        [string]$RoleName,
        [string]$LogGroupName,
        [int]$RetentionDays
    )

    try {
        aws logs create-log-group --region $Region --log-group-name $LogGroupName | Out-Null
    } catch {
    }
    aws logs put-retention-policy `
        --region $Region `
        --log-group-name $LogGroupName `
        --retention-in-days $RetentionDays | Out-Null

    $flowLogsTrustPolicy = @{
        Version = "2012-10-17"
        Statement = @(
            @{
                Effect = "Allow"
                Principal = @{
                    Service = "vpc-flow-logs.amazonaws.com"
                }
                Action = "sts:AssumeRole"
            }
        )
    }
    $logGroupArn = "arn:aws:logs:${Region}:${AccountId}:log-group:$LogGroupName"
    $flowLogsPolicy = @{
        Version = "2012-10-17"
        Statement = @(
            @{
                Sid = "WriteVpcFlowLogs"
                Effect = "Allow"
                Action = @(
                    "logs:CreateLogStream",
                    "logs:DescribeLogGroups",
                    "logs:DescribeLogStreams",
                    "logs:PutLogEvents"
                )
                Resource = @(
                    $logGroupArn,
                    "${logGroupArn}:*"
                )
            }
        )
    }
    $flowLogsRoleArn = Ensure-Role `
        -RoleName $RoleName `
        -TrustPolicy $flowLogsTrustPolicy `
        -InlinePolicy $flowLogsPolicy `
        -InlinePolicyName "$RoleName-inline"

    $existingFlowLogId = aws ec2 describe-flow-logs `
        --region $Region `
        --filter Name=resource-id,Values=$ResolvedVpcId Name=log-destination-type,Values=cloud-watch-logs `
        --query "FlowLogs[0].FlowLogId" `
        --output text

    if ([string]::IsNullOrWhiteSpace($existingFlowLogId) -or $existingFlowLogId -eq "None") {
        $createdFlowLogId = aws ec2 create-flow-logs `
            --region $Region `
            --resource-type VPC `
            --resource-ids $ResolvedVpcId `
            --traffic-type ALL `
            --log-destination-type cloud-watch-logs `
            --log-group-name $LogGroupName `
            --deliver-logs-permission-arn $flowLogsRoleArn `
            --query "FlowLogIds[0]" `
            --output text
        Write-Host "VPC Flow Logs created: $createdFlowLogId"
        return
    }

    Write-Host "VPC Flow Logs already enabled: $existingFlowLogId"
}

Require-Command -Name "aws"
$script:AwsCliPath = (Get-Command aws -CommandType Application -ErrorAction Stop).Source
Set-Alias -Name aws -Value Invoke-AwsChecked -Scope Script

if (-not [string]::IsNullOrWhiteSpace($AwsProfile)) {
    $env:AWS_PROFILE = $AwsProfile.Trim()
}

$accountId = aws sts get-caller-identity `
    --region $AwsRegion `
    --query Account `
    --output text

if ($accountId -notmatch '^\d{12}$') {
    throw "Could not resolve the current AWS account ID."
}

$resolvedVpcId = Resolve-BackendVpcId -ExplicitVpcId $VpcId -Region $AwsRegion -BackendInstanceTagName $InstanceTagName
$resolvedConfigBucketName = if ([string]::IsNullOrWhiteSpace($ConfigBucketName)) { "$StackPrefix-config-$accountId-$AwsRegion" } else { $ConfigBucketName.Trim() }
$resolvedConfigRoleName = if ([string]::IsNullOrWhiteSpace($ConfigRoleName)) { "$StackPrefix-config-recorder-role" } else { $ConfigRoleName.Trim() }
$resolvedConfigRecorderName = if ([string]::IsNullOrWhiteSpace($ConfigRecorderName)) { "$StackPrefix-config-recorder" } else { $ConfigRecorderName.Trim() }
$resolvedConfigDeliveryChannelName = if ([string]::IsNullOrWhiteSpace($ConfigDeliveryChannelName)) { "$StackPrefix-config-delivery" } else { $ConfigDeliveryChannelName.Trim() }
$resolvedFlowLogsRoleName = if ([string]::IsNullOrWhiteSpace($FlowLogsRoleName)) { "$StackPrefix-vpc-flow-logs-role" } else { $FlowLogsRoleName.Trim() }
$resolvedFlowLogsLogGroupName = if ([string]::IsNullOrWhiteSpace($FlowLogsLogGroupName)) { "/aws/vpc/$StackPrefix-backend-flow-logs" } else { $FlowLogsLogGroupName.Trim() }

$guardDutyEnabled = Ensure-GuardDuty -Region $AwsRegion
Ensure-ConfigRecorder `
    -Region $AwsRegion `
    -AccountId $accountId `
    -BucketName $resolvedConfigBucketName `
    -RoleName $resolvedConfigRoleName `
    -RecorderName $resolvedConfigRecorderName `
    -DeliveryChannelName $resolvedConfigDeliveryChannelName
Ensure-VpcFlowLogs `
    -Region $AwsRegion `
    -AccountId $accountId `
    -ResolvedVpcId $resolvedVpcId `
    -RoleName $resolvedFlowLogsRoleName `
    -LogGroupName $resolvedFlowLogsLogGroupName `
    -RetentionDays $FlowLogsRetentionDays

Write-Host "AWS security posture bootstrap complete."
if ($guardDutyEnabled) {
    Write-Host "GuardDuty: enabled"
} else {
    Write-Host "GuardDuty: blocked - account subscription required"
}
Write-Host "AWS Config recorder: $resolvedConfigRecorderName"
Write-Host "AWS Config bucket: $resolvedConfigBucketName"
Write-Host "VPC Flow Logs: $resolvedVpcId -> $resolvedFlowLogsLogGroupName"

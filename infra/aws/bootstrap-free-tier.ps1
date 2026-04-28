param(
    [string]$StackPrefix = "aura",
    [string]$AwsRegion = "ap-south-1",
    [string]$InstanceType = "t4g.small",
    [string]$ParameterStorePathPrefix = "/aura/prod",
    [string]$FrontendOrigin = "https://aurapilot.vercel.app",
    [string]$SecondaryFrontendOrigin = "https://aurapilot.netlify.app",
    [string]$AwsFrontendOrigin = "",
    [string]$DeployBucketName = "aura-backend-deployments",
    [string]$MediaBucketName = "aura-review-media",
    [string]$InstanceTagName = "aura-backend",
    [string]$AllowedIpv4Cidr = "0.0.0.0/0",
    [string]$SubnetId = "",
    [string]$VpcId = "",
    [int]$RootVolumeSizeGiB = 16
)

$ErrorActionPreference = "Stop"

function Require-Command {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found on PATH."
    }
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

function Configure-BucketDefaults {
    param(
        [string]$BucketName,
        [string]$StackName,
        [string]$Purpose,
        [string]$LifecycleConfigurationJson = ""
    )

    $encryptionConfiguration = @{
        Rules = @(
            @{
                ApplyServerSideEncryptionByDefault = @{
                    SSEAlgorithm = "AES256"
                }
            }
        )
    } | ConvertTo-Json -Depth 6 -Compress
    $encryptionFile = Join-Path $env:TEMP "$BucketName-encryption.json"
    $encryptionConfiguration | Set-Content -LiteralPath $encryptionFile -Encoding ascii

    $taggingConfiguration = @{
        TagSet = @(
            @{
                Key = "App"
                Value = "Aura"
            },
            @{
                Key = "Stack"
                Value = $StackName
            },
            @{
                Key = "Purpose"
                Value = $Purpose
            }
        )
    } | ConvertTo-Json -Depth 6 -Compress
    $taggingFile = Join-Path $env:TEMP "$BucketName-tagging.json"
    $taggingConfiguration | Set-Content -LiteralPath $taggingFile -Encoding ascii

    aws s3api put-public-access-block `
        --bucket $BucketName `
        --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" | Out-Null

    aws s3api put-bucket-encryption `
        --bucket $BucketName `
        --server-side-encryption-configuration "file://$encryptionFile" | Out-Null

    aws s3api put-bucket-tagging `
        --bucket $BucketName `
        --tagging "file://$taggingFile" | Out-Null

    if (-not [string]::IsNullOrWhiteSpace($LifecycleConfigurationJson)) {
        $lifecycleFile = Join-Path $env:TEMP "$BucketName-lifecycle.json"
        $LifecycleConfigurationJson | Set-Content -LiteralPath $lifecycleFile -Encoding ascii
        aws s3api put-bucket-lifecycle-configuration `
            --bucket $BucketName `
            --lifecycle-configuration "file://$lifecycleFile" | Out-Null
    }
}

function Resolve-InstanceArchitecture {
    param([string]$Region, [string]$ResolvedInstanceType)

    $architecture = aws ec2 describe-instance-types `
        --region $Region `
        --instance-types $ResolvedInstanceType `
        --query "InstanceTypes[0].ProcessorInfo.SupportedArchitectures[0]" `
        --output text

    if ([string]::IsNullOrWhiteSpace($architecture) -or $architecture -eq "None") {
        throw "Could not resolve architecture for instance type '$ResolvedInstanceType'."
    }

    return $architecture
}

function Resolve-AmiId {
    param([string]$Architecture)

    switch ($Architecture) {
        "arm64" {
            return "resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
        }
        "x86_64" {
            return "resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
        }
        default {
            throw "Unsupported architecture '$Architecture'."
        }
    }
}

function Ensure-InstanceRole {
    param(
        [string]$RoleName,
        [string]$ProfileName,
        [string]$Region,
        [string]$ParameterPrefix,
        [string]$DeployBucket,
        [string]$MediaBucket
    )

    $trustPolicy = @{
        Version = "2012-10-17"
        Statement = @(
            @{
                Effect = "Allow"
                Principal = @{
                    Service = "ec2.amazonaws.com"
                }
                Action = "sts:AssumeRole"
            }
        )
    } | ConvertTo-Json -Depth 6
    $trustPolicyFile = Join-Path $env:TEMP "$RoleName-trust.json"
    $trustPolicy | Set-Content -LiteralPath $trustPolicyFile -Encoding ascii

    $null = aws iam get-role --role-name $RoleName 2>$null
    $roleExists = ($LASTEXITCODE -eq 0)

    if (-not $roleExists) {
        aws iam create-role `
            --role-name $RoleName `
            --assume-role-policy-document "file://$trustPolicyFile" | Out-Null
    }

    aws iam attach-role-policy `
        --role-name $RoleName `
        --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore | Out-Null

    $policyDocument = @{
        Version = "2012-10-17"
        Statement = @(
            @{
                Sid = "ParameterStoreRuntime"
                Effect = "Allow"
                Action = @(
                    "ssm:GetParameter",
                    "ssm:GetParameters",
                    "ssm:GetParametersByPath"
                )
                Resource = "arn:aws:ssm:${Region}:*:parameter$($ParameterPrefix.TrimEnd('/'))*"
            },
            @{
                Sid = "DeployArtifacts"
                Effect = "Allow"
                Action = @(
                    "s3:GetObject",
                    "s3:ListBucket"
                )
                Resource = @(
                    "arn:aws:s3:::$DeployBucket",
                    "arn:aws:s3:::$DeployBucket/*"
                )
            },
            @{
                Sid = "ReviewMedia"
                Effect = "Allow"
                Action = @(
                    "s3:AbortMultipartUpload",
                    "s3:GetObject",
                    "s3:ListBucket",
                    "s3:PutObject"
                )
                Resource = @(
                    "arn:aws:s3:::$MediaBucket",
                    "arn:aws:s3:::$MediaBucket/*"
                )
            }
        )
    } | ConvertTo-Json -Depth 8
    $policyFile = Join-Path $env:TEMP "$RoleName-inline.json"
    $policyDocument | Set-Content -LiteralPath $policyFile -Encoding ascii

    aws iam put-role-policy `
        --role-name $RoleName `
        --policy-name "$RoleName-inline" `
        --policy-document "file://$policyFile" | Out-Null

    $null = aws iam get-instance-profile --instance-profile-name $ProfileName 2>$null
    $profileExists = ($LASTEXITCODE -eq 0)

    if (-not $profileExists) {
        aws iam create-instance-profile --instance-profile-name $ProfileName | Out-Null
        Start-Sleep -Seconds 5
    }

    $existingProfileRole = aws iam get-instance-profile `
        --instance-profile-name $ProfileName `
        --query "InstanceProfile.Roles[?RoleName=='$RoleName'] | [0].RoleName" `
        --output text

    if ([string]::IsNullOrWhiteSpace($existingProfileRole) -or $existingProfileRole -eq "None") {
        aws iam add-role-to-instance-profile `
            --instance-profile-name $ProfileName `
            --role-name $RoleName 2>$null | Out-Null
    }
}

Require-Command -Name "aws"

$resolvedVpcId = if ([string]::IsNullOrWhiteSpace($VpcId)) {
    aws ec2 describe-vpcs `
        --region $AwsRegion `
        --filters Name=isDefault,Values=true `
        --query "Vpcs[0].VpcId" `
        --output text
} else {
    $VpcId
}

if ([string]::IsNullOrWhiteSpace($resolvedVpcId) -or $resolvedVpcId -eq "None") {
    throw "Could not resolve a default VPC. Pass -VpcId explicitly."
}

$resolvedSubnetId = if ([string]::IsNullOrWhiteSpace($SubnetId)) {
    aws ec2 describe-subnets `
        --region $AwsRegion `
        --filters Name=default-for-az,Values=true Name=vpc-id,Values=$resolvedVpcId `
        --query "Subnets[0].SubnetId" `
        --output text
} else {
    $SubnetId
}

if ([string]::IsNullOrWhiteSpace($resolvedSubnetId) -or $resolvedSubnetId -eq "None") {
    throw "Could not resolve a default subnet. Pass -SubnetId explicitly."
}

$securityGroupName = "$StackPrefix-backend-sg"
$existingSecurityGroupId = aws ec2 describe-security-groups `
    --region $AwsRegion `
    --filters Name=group-name,Values=$securityGroupName Name=vpc-id,Values=$resolvedVpcId `
    --query "SecurityGroups[0].GroupId" `
    --output text

$securityGroupId = if ([string]::IsNullOrWhiteSpace($existingSecurityGroupId) -or $existingSecurityGroupId -eq "None") {
    aws ec2 create-security-group `
        --region $AwsRegion `
        --group-name $securityGroupName `
        --description "Aura backend EC2 security group" `
        --vpc-id $resolvedVpcId `
        --query "GroupId" `
        --output text
} else {
    $existingSecurityGroupId
}

try {
    $ingressPermissions = "[{""IpProtocol"":""tcp"",""FromPort"":80,""ToPort"":80,""IpRanges"":[{""CidrIp"":""$AllowedIpv4Cidr""}]},{""IpProtocol"":""tcp"",""FromPort"":443,""ToPort"":443,""IpRanges"":[{""CidrIp"":""$AllowedIpv4Cidr""}]}]"
    $ingressFile = Join-Path $env:TEMP "$securityGroupName-ingress.json"
    $ingressPermissions | Set-Content -LiteralPath $ingressFile -Encoding ascii
    aws ec2 authorize-security-group-ingress `
        --region $AwsRegion `
        --group-id $securityGroupId `
        --ip-permissions "file://$ingressFile" | Out-Null
} catch {
}

try {
    $legacyIngressPermissions = "[{""IpProtocol"":""tcp"",""FromPort"":5000,""ToPort"":5000,""IpRanges"":[{""CidrIp"":""0.0.0.0/0""}]}]"
    $legacyIngressFile = Join-Path $env:TEMP "$securityGroupName-legacy-ingress.json"
    $legacyIngressPermissions | Set-Content -LiteralPath $legacyIngressFile -Encoding ascii
    aws ec2 revoke-security-group-ingress `
        --region $AwsRegion `
        --group-id $securityGroupId `
        --ip-permissions "file://$legacyIngressFile" | Out-Null
} catch {
}

Ensure-Bucket -BucketName $DeployBucketName -Region $AwsRegion
Ensure-Bucket -BucketName $MediaBucketName -Region $AwsRegion

$deployLifecycle = @{
    Rules = @(
        @{
            ID = "ExpireDeployArtifacts"
            Status = "Enabled"
            Filter = @{
                Prefix = "releases/"
            }
            Expiration = @{
                Days = 14
            }
            AbortIncompleteMultipartUpload = @{
                DaysAfterInitiation = 1
            }
        }
    )
} | ConvertTo-Json -Depth 8 -Compress
$mediaLifecycle = @{
    Rules = @(
        @{
            ID = "AbortIncompleteUploads"
            Status = "Enabled"
            Filter = @{
                Prefix = ""
            }
            AbortIncompleteMultipartUpload = @{
                DaysAfterInitiation = 1
            }
        }
    )
} | ConvertTo-Json -Depth 8 -Compress
Configure-BucketDefaults -BucketName $DeployBucketName -StackName $StackPrefix -Purpose "deploy-artifacts" -LifecycleConfigurationJson $deployLifecycle
Configure-BucketDefaults -BucketName $MediaBucketName -StackName $StackPrefix -Purpose "review-media" -LifecycleConfigurationJson $mediaLifecycle

$roleName = "$StackPrefix-backend-ec2-role"
$profileName = "$StackPrefix-backend-ec2-profile"
Ensure-InstanceRole `
    -RoleName $roleName `
    -ProfileName $profileName `
    -Region $AwsRegion `
    -ParameterPrefix $ParameterStorePathPrefix `
    -DeployBucket $DeployBucketName `
    -MediaBucket $MediaBucketName

$userDataTemplatePath = Join-Path $PSScriptRoot "bootstrap-instance-user-data.sh"
$userData = Get-Content -LiteralPath $userDataTemplatePath -Raw
$userData = $userData.Replace("AWS_REGION=ap-south-1", "AWS_REGION=$AwsRegion")
$userData = $userData.Replace("AWS_PARAMETER_STORE_PATH_PREFIX=/aura/prod", "AWS_PARAMETER_STORE_PATH_PREFIX=$ParameterStorePathPrefix")
$userData = $userData.Replace("AWS_S3_REVIEW_BUCKET=replace-with-your-media-bucket", "AWS_S3_REVIEW_BUCKET=$MediaBucketName")
$frontendOrigins = @($FrontendOrigin, $SecondaryFrontendOrigin, $AwsFrontendOrigin) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
$frontendOriginList = [string]::Join(',', $frontendOrigins)
$userData = $userData.Replace(
    "CORS_ORIGIN=https://aurapilot.vercel.app,https://aurapilot.netlify.app,https://aura-mdsaifulislammsiss-projects.vercel.app",
    "CORS_ORIGIN=$frontendOriginList"
)
$userData = $userData.Replace("APP_PUBLIC_URL=https://your-vercel-project.vercel.app", "APP_PUBLIC_URL=$FrontendOrigin")
$userDataFile = Join-Path $env:TEMP "$StackPrefix-backend-user-data.sh"
$userData | Set-Content -LiteralPath $userDataFile -Encoding ascii

$existingInstanceId = aws ec2 describe-instances `
    --region $AwsRegion `
    --filters Name=tag:Name,Values=$InstanceTagName Name=instance-state-name,Values=pending,running,stopping,stopped `
    --query "Reservations | sort_by(@,&Instances[0].LaunchTime)[-1].Instances[0].InstanceId" `
    --output text

if (-not [string]::IsNullOrWhiteSpace($existingInstanceId) -and $existingInstanceId -ne "None") {
    $existingState = aws ec2 describe-instances `
        --region $AwsRegion `
        --instance-ids $existingInstanceId `
        --query "Reservations[0].Instances[0].State.Name" `
        --output text

    if ($existingState -eq "stopped") {
        aws ec2 start-instances `
            --region $AwsRegion `
            --instance-ids $existingInstanceId | Out-Null
    }

    Write-Host "Reusing existing backend instance."
    Write-Host "InstanceId: $existingInstanceId"
    Write-Host "Deploy bucket: $DeployBucketName"
    Write-Host "Media bucket: $MediaBucketName"
    Write-Host "Security group: $securityGroupId"
    exit 0
}

$instanceArchitecture = Resolve-InstanceArchitecture -Region $AwsRegion -ResolvedInstanceType $InstanceType
$amiId = Resolve-AmiId -Architecture $instanceArchitecture
$rootBlockDeviceMappings = "[{""DeviceName"":""/dev/xvda"",""Ebs"":{""VolumeSize"":$RootVolumeSizeGiB,""VolumeType"":""gp3"",""DeleteOnTermination"":true}}]"
$rootBlockDeviceFile = Join-Path $env:TEMP "$StackPrefix-root-volume.json"
$rootBlockDeviceMappings | Set-Content -LiteralPath $rootBlockDeviceFile -Encoding ascii

$instanceId = aws ec2 run-instances `
    --region $AwsRegion `
    --image-id $amiId `
    --instance-type $InstanceType `
    --iam-instance-profile "Name=$profileName" `
    --security-group-ids $securityGroupId `
    --subnet-id $resolvedSubnetId `
    --block-device-mappings "file://$rootBlockDeviceFile" `
    --metadata-options "HttpTokens=required,HttpEndpoint=enabled" `
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$InstanceTagName},{Key=App,Value=Aura},{Key=Role,Value=backend},{Key=Architecture,Value=$instanceArchitecture},{Key=CostProfile,Value=free-plan}]" `
    --user-data "file://$userDataFile" `
    --query "Instances[0].InstanceId" `
    --output text

if ([string]::IsNullOrWhiteSpace($instanceId) -or $instanceId -eq "None") {
    throw "EC2 instance launch did not return an instance ID."
}

Write-Host "EC2 backend bootstrap launched."
Write-Host "InstanceId: $instanceId"
Write-Host "Architecture: $instanceArchitecture"
Write-Host "Deploy bucket: $DeployBucketName"
Write-Host "Media bucket: $MediaBucketName"
Write-Host "Security group: $securityGroupId"
Write-Host "Edit /opt/aura/shared/base.env on the instance once SSM comes online."

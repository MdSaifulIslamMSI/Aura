param(
    [string]$StackPrefix = "aura",
    [string]$AwsRegion = "ap-south-1",
    [string]$InstanceType = "t3.micro",
    [string]$ParameterStorePathPrefix = "/aura/prod",
    [string]$DeployBucketName = "aura-backend-deployments",
    [string]$MediaBucketName = "aura-review-media",
    [string]$InstanceTagName = "aura-backend",
    [string]$AllowedIpv4Cidr = "0.0.0.0/0",
    [string]$SubnetId = "",
    [string]$VpcId = ""
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

    try {
        aws iam add-role-to-instance-profile `
            --instance-profile-name $ProfileName `
            --role-name $RoleName | Out-Null
    } catch {
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
    aws ec2 authorize-security-group-ingress `
        --region $AwsRegion `
        --group-id $securityGroupId `
        --ip-permissions "[{`"IpProtocol`":`"tcp`",`"FromPort`":5000,`"ToPort`":5000,`"IpRanges`":[{`"CidrIp`":`"$AllowedIpv4Cidr`"}]}]" | Out-Null
} catch {
}

Ensure-Bucket -BucketName $DeployBucketName -Region $AwsRegion
Ensure-Bucket -BucketName $MediaBucketName -Region $AwsRegion

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
$userDataFile = Join-Path $env:TEMP "$StackPrefix-backend-user-data.sh"
$userData | Set-Content -LiteralPath $userDataFile -Encoding ascii

$instanceId = aws ec2 run-instances `
    --region $AwsRegion `
    --image-id "resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64" `
    --instance-type $InstanceType `
    --iam-instance-profile "Name=$profileName" `
    --security-group-ids $securityGroupId `
    --subnet-id $resolvedSubnetId `
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$InstanceTagName},{Key=App,Value=Aura},{Key=Role,Value=backend}]" `
    --user-data "file://$userDataFile" `
    --query "Instances[0].InstanceId" `
    --output text

Write-Host "EC2 backend bootstrap launched."
Write-Host "InstanceId: $instanceId"
Write-Host "Deploy bucket: $DeployBucketName"
Write-Host "Media bucket: $MediaBucketName"
Write-Host "Security group: $securityGroupId"
Write-Host "Edit /opt/aura/shared/base.env on the instance once SSM comes online."

param(
    [string]$StackPrefix = "aura",
    [string]$AwsRegion = "ap-south-1",
    [string]$AwsProfile = "",
    [string]$BucketName = "",
    [string]$PriceClass = "PriceClass_100"
)

$ErrorActionPreference = "Stop"

function Require-Command {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found on PATH."
    }
}

function Write-JsonFile {
    param(
        [string]$Name,
        [object]$Value,
        [int]$Depth = 20
    )

    $path = Join-Path $env:TEMP $Name
    ConvertTo-Json -InputObject $Value -Depth $Depth | Set-Content -LiteralPath $path -Encoding ascii
    return $path
}

function Get-FirstCloudFrontItem {
    param(
        [object]$Collection
    )

    if ($null -eq $Collection) {
        return $null
    }

    if ($Collection -is [array]) {
        return $Collection | Select-Object -First 1
    }

    return $Collection
}

Require-Command -Name "aws"

if (-not [string]::IsNullOrWhiteSpace($AwsProfile)) {
    $env:AWS_PROFILE = $AwsProfile.Trim()
}

$accountId = aws sts get-caller-identity --query "Account" --output text
if ([string]::IsNullOrWhiteSpace($accountId) -or $accountId -eq "None") {
    throw "Could not resolve AWS account id."
}

$resolvedBucketName = if ([string]::IsNullOrWhiteSpace($BucketName)) {
    "aura-frontend-$accountId-$AwsRegion"
} else {
    $BucketName.Trim()
}

aws s3api head-bucket --bucket $resolvedBucketName --region $AwsRegion | Out-Null

$originId = "$StackPrefix-frontend-s3-origin"
$originDomain = "$resolvedBucketName.s3.$AwsRegion.amazonaws.com"
$oacName = "$StackPrefix-frontend-oac"

$originAccessControls = aws cloudfront list-origin-access-controls --output json | ConvertFrom-Json
$originAccessControl = Get-FirstCloudFrontItem -Collection @(
    $originAccessControls.OriginAccessControlList.Items |
        Where-Object {
            $_.Name -eq $oacName -and
            $_.OriginAccessControlOriginType -eq "s3" -and
            $_.SigningBehavior -eq "always"
        }
)

if ($null -eq $originAccessControl) {
    $oacConfigFile = Write-JsonFile -Name "$oacName.json" -Value @{
        Name = $oacName
        Description = "OAC for Aura frontend S3 origin"
        SigningProtocol = "sigv4"
        SigningBehavior = "always"
        OriginAccessControlOriginType = "s3"
    }

    $originAccessControl = aws cloudfront create-origin-access-control `
        --origin-access-control-config "file://$oacConfigFile" `
        --output json | ConvertFrom-Json
    $originAccessControl = $originAccessControl.OriginAccessControl
}

$distributions = aws cloudfront list-distributions --output json | ConvertFrom-Json
$distributionSummary = Get-FirstCloudFrontItem -Collection @(
    $distributions.DistributionList.Items |
        Where-Object {
            $originDomains = @($_.Origins.Items | ForEach-Object { $_.DomainName })
            $originDomains -contains $originDomain
        }
)

if ($null -eq $distributionSummary) {
    $distributionConfigFile = Write-JsonFile -Name "$StackPrefix-frontend-cloudfront-distribution.json" -Value @{
        CallerReference = "$StackPrefix-frontend-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
        Comment = "Aura frontend HTTPS static site"
        Enabled = $true
        IsIPV6Enabled = $true
        PriceClass = $PriceClass
        HttpVersion = "http2and3"
        DefaultRootObject = "index.html"
        Aliases = @{
            Quantity = 0
        }
        Origins = @{
            Quantity = 1
            Items = @(
                @{
                    Id = $originId
                    DomainName = $originDomain
                    OriginAccessControlId = $originAccessControl.Id
                    S3OriginConfig = @{
                        OriginAccessIdentity = ""
                    }
                    OriginShield = @{
                        Enabled = $false
                    }
                    ConnectionAttempts = 3
                    ConnectionTimeout = 10
                }
            )
        }
        DefaultCacheBehavior = @{
            TargetOriginId = $originId
            ViewerProtocolPolicy = "redirect-to-https"
            CachePolicyId = "658327ea-f89d-4fab-a63d-7e88639e58f6"
            ResponseHeadersPolicyId = "67f7725c-6f97-4210-82d7-5512b31e9d03"
            Compress = $true
            AllowedMethods = @{
                Quantity = 3
                Items = @("GET", "HEAD", "OPTIONS")
                CachedMethods = @{
                    Quantity = 3
                    Items = @("GET", "HEAD", "OPTIONS")
                }
            }
            TrustedSigners = @{
                Enabled = $false
                Quantity = 0
            }
            TrustedKeyGroups = @{
                Enabled = $false
                Quantity = 0
            }
            LambdaFunctionAssociations = @{
                Quantity = 0
            }
            FunctionAssociations = @{
                Quantity = 0
            }
            FieldLevelEncryptionId = ""
        }
        CustomErrorResponses = @{
            Quantity = 2
            Items = @(
                @{
                    ErrorCode = 403
                    ResponsePagePath = "/index.html"
                    ResponseCode = "200"
                    ErrorCachingMinTTL = 0
                },
                @{
                    ErrorCode = 404
                    ResponsePagePath = "/index.html"
                    ResponseCode = "200"
                    ErrorCachingMinTTL = 0
                }
            )
        }
        ViewerCertificate = @{
            CloudFrontDefaultCertificate = $true
        }
        Restrictions = @{
            GeoRestriction = @{
                RestrictionType = "none"
                Quantity = 0
            }
        }
    }

    $distribution = aws cloudfront create-distribution `
        --distribution-config "file://$distributionConfigFile" `
        --output json | ConvertFrom-Json
} else {
    $distribution = aws cloudfront get-distribution `
        --id $distributionSummary.Id `
        --output json | ConvertFrom-Json
}

$distributionId = $distribution.Distribution.Id
$distributionArn = $distribution.Distribution.ARN
$distributionDomainName = $distribution.Distribution.DomainName

$bucketPolicyFile = Write-JsonFile -Name "$resolvedBucketName-cloudfront-policy.json" -Value @{
    Version = "2012-10-17"
    Statement = @(
        @{
            Sid = "AllowCloudFrontReadOnly"
            Effect = "Allow"
            Principal = @{
                Service = "cloudfront.amazonaws.com"
            }
            Action = "s3:GetObject"
            Resource = "arn:aws:s3:::$resolvedBucketName/*"
            Condition = @{
                StringEquals = @{
                    "AWS:SourceArn" = $distributionArn
                }
            }
        }
    )
}

aws s3api put-bucket-policy `
    --bucket $resolvedBucketName `
    --policy "file://$bucketPolicyFile" `
    --region $AwsRegion | Out-Null

aws s3api put-public-access-block `
    --bucket $resolvedBucketName `
    --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" `
    --region $AwsRegion | Out-Null

$taggingFile = Write-JsonFile -Name "$distributionId-tags.json" -Value @{
    Items = @(
        @{
            Key = "App"
            Value = "Aura"
        },
        @{
            Key = "Stack"
            Value = $StackPrefix
        },
        @{
            Key = "Purpose"
            Value = "frontend-static-site"
        },
        @{
            Key = "CostProfile"
            Value = "low-spend-cloudfront-static"
        }
    )
}

aws cloudfront tag-resource `
    --resource $distributionArn `
    --tags "file://$taggingFile" | Out-Null

Write-Host "CloudFront frontend ready."
Write-Host "Distribution ID: $distributionId"
Write-Host "Distribution ARN: $distributionArn"
Write-Host "HTTPS URL: https://$distributionDomainName"
Write-Host "Origin bucket: $resolvedBucketName"
Write-Host "Origin access control: $($originAccessControl.Id)"

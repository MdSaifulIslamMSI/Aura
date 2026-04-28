param(
    [string]$StackPrefix = "aura",
    [string]$AwsRegion = "ap-south-1",
    [string]$AwsProfile = "",
    [string]$BucketName = "",
    [string]$BackendOrigin = "https://13.206.172.186.sslip.io",
    [string]$PriceClass = "PriceClass_100"
)

$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $true
}

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

function Assert-AbsoluteHttpsOrigin {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw "Backend origin is required."
    }

    $origin = [System.Uri]$Value.Trim().TrimEnd("/")
    if ($origin.Scheme -ne "https" -or [string]::IsNullOrWhiteSpace($origin.Host)) {
        throw "Backend origin must be an absolute HTTPS origin. Received '$Value'."
    }

    return $origin
}

function Ensure-CloudFrontFunction {
    param(
        [string]$FunctionName,
        [string]$Code
    )

    $codeFile = Join-Path $env:TEMP "$FunctionName.js"
    $configFile = Write-JsonFile -Name "$FunctionName-config.json" -Value @{
        Comment = "Aura frontend SPA fallback rewrite"
        Runtime = "cloudfront-js-2.0"
    }
    $Code | Set-Content -LiteralPath $codeFile -Encoding ascii

    $nativeErrorPreferenceVariable = Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue
    if ($nativeErrorPreferenceVariable) {
        $previousNativeErrorPreference = $PSNativeCommandUseErrorActionPreference
        $PSNativeCommandUseErrorActionPreference = $false
    }

    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $describeJson = aws cloudfront describe-function --name $FunctionName --stage DEVELOPMENT --output json 2>$null
        $functionExists = ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($describeJson))
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
        if ($nativeErrorPreferenceVariable) {
            $PSNativeCommandUseErrorActionPreference = $previousNativeErrorPreference
        }
    }

    if ($functionExists) {
        $etag = ($describeJson | ConvertFrom-Json).ETag
        $updated = aws cloudfront update-function `
            --name $FunctionName `
            --if-match $etag `
            --function-config "file://$configFile" `
            --function-code "fileb://$codeFile" `
            --output json | ConvertFrom-Json
        $etag = $updated.ETag
    } else {
        $created = aws cloudfront create-function `
            --name $FunctionName `
            --function-config "file://$configFile" `
            --function-code "fileb://$codeFile" `
            --output json | ConvertFrom-Json
        $etag = $created.ETag
    }

    $published = aws cloudfront publish-function `
        --name $FunctionName `
        --if-match $etag `
        --output json | ConvertFrom-Json

    return $published.FunctionSummary.FunctionMetadata.FunctionARN
}

function New-ProxyCacheBehavior {
    param(
        [string]$PathPattern,
        [string]$TargetOriginId
    )

    return @{
        PathPattern = $PathPattern
        TargetOriginId = $TargetOriginId
        ViewerProtocolPolicy = "redirect-to-https"
        CachePolicyId = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
        OriginRequestPolicyId = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
        SmoothStreaming = $false
        Compress = $true
        AllowedMethods = @{
            Quantity = 7
            Items = @("GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE")
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
        GrpcConfig = @{
            Enabled = $false
        }
    }
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
$backendOriginUri = Assert-AbsoluteHttpsOrigin -Value $BackendOrigin

aws s3api head-bucket --bucket $resolvedBucketName --region $AwsRegion | Out-Null

$originId = "$StackPrefix-frontend-s3-origin"
$backendOriginId = "$StackPrefix-backend-origin"
$originDomain = "$resolvedBucketName.s3.$AwsRegion.amazonaws.com"
$oacName = "$StackPrefix-frontend-oac"
$functionName = "$StackPrefix-frontend-spa-rewrite"
$spaRewriteFunctionCode = @'
function handler(event) {
    var request = event.request;
    var uri = request.uri || '/';

    if (
        uri === '/api' || uri.indexOf('/api/') === 0 ||
        uri === '/socket.io' || uri.indexOf('/socket.io/') === 0 ||
        uri === '/health' || uri.indexOf('/health/') === 0 ||
        uri === '/uploads' || uri.indexOf('/uploads/') === 0
    ) {
        return request;
    }

    var lastSegment = uri.substring(uri.lastIndexOf('/') + 1);
    var hasExtension = lastSegment.indexOf('.') !== -1;
    if (uri === '/' || (!hasExtension && uri.indexOf('/assets/') !== 0)) {
        request.uri = '/index.html';
    }

    return request;
}
'@
$spaRewriteFunctionArn = Ensure-CloudFrontFunction -FunctionName $functionName -Code $spaRewriteFunctionCode

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
            Quantity = 2
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
                },
                @{
                    Id = $backendOriginId
                    DomainName = $backendOriginUri.Host
                    OriginPath = ""
                    CustomHeaders = @{
                        Quantity = 0
                    }
                    CustomOriginConfig = @{
                        HTTPPort = 80
                        HTTPSPort = 443
                        OriginProtocolPolicy = "https-only"
                        OriginSslProtocols = @{
                            Quantity = 1
                            Items = @("TLSv1.2")
                        }
                        OriginReadTimeout = 30
                        OriginKeepaliveTimeout = 5
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
                Quantity = 1
                Items = @(
                    @{
                        EventType = "viewer-request"
                        FunctionARN = $spaRewriteFunctionArn
                    }
                )
            }
            FieldLevelEncryptionId = ""
        }
        CacheBehaviors = @{
            Quantity = 7
            Items = @(
                (New-ProxyCacheBehavior -PathPattern "/api" -TargetOriginId $backendOriginId),
                (New-ProxyCacheBehavior -PathPattern "/api/*" -TargetOriginId $backendOriginId),
                (New-ProxyCacheBehavior -PathPattern "/socket.io" -TargetOriginId $backendOriginId),
                (New-ProxyCacheBehavior -PathPattern "/socket.io/*" -TargetOriginId $backendOriginId),
                (New-ProxyCacheBehavior -PathPattern "/health" -TargetOriginId $backendOriginId),
                (New-ProxyCacheBehavior -PathPattern "/health/*" -TargetOriginId $backendOriginId),
                (New-ProxyCacheBehavior -PathPattern "/uploads/*" -TargetOriginId $backendOriginId)
            )
        }
        CustomErrorResponses = @{
            Quantity = 0
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

$configEnvelope = aws cloudfront get-distribution-config `
    --id $distributionId `
    --output json | ConvertFrom-Json
$distributionConfig = $configEnvelope.DistributionConfig
$etag = $configEnvelope.ETag
$s3Origin = Get-FirstCloudFrontItem -Collection @(
    $distributionConfig.Origins.Items | Where-Object { $_.Id -eq $originId }
)
if ($null -eq $s3Origin) {
    throw "Could not find S3 origin '$originId' on distribution '$distributionId'."
}

$backendOriginConfig = @{
    Id = $backendOriginId
    DomainName = $backendOriginUri.Host
    OriginPath = ""
    CustomHeaders = @{
        Quantity = 0
    }
    CustomOriginConfig = @{
        HTTPPort = 80
        HTTPSPort = 443
        OriginProtocolPolicy = "https-only"
        OriginSslProtocols = @{
            Quantity = 1
            Items = @("TLSv1.2")
        }
        OriginReadTimeout = 30
        OriginKeepaliveTimeout = 5
    }
    OriginShield = @{
        Enabled = $false
    }
    ConnectionAttempts = 3
    ConnectionTimeout = 10
}

$distributionConfig.Origins = @{
    Quantity = 2
    Items = @($s3Origin, $backendOriginConfig)
}
$distributionConfig.DefaultCacheBehavior.FunctionAssociations = @{
    Quantity = 1
    Items = @(
        @{
            EventType = "viewer-request"
            FunctionARN = $spaRewriteFunctionArn
        }
    )
}
$distributionConfig.CacheBehaviors = @{
    Quantity = 7
    Items = @(
        (New-ProxyCacheBehavior -PathPattern "/api" -TargetOriginId $backendOriginId),
        (New-ProxyCacheBehavior -PathPattern "/api/*" -TargetOriginId $backendOriginId),
        (New-ProxyCacheBehavior -PathPattern "/socket.io" -TargetOriginId $backendOriginId),
        (New-ProxyCacheBehavior -PathPattern "/socket.io/*" -TargetOriginId $backendOriginId),
        (New-ProxyCacheBehavior -PathPattern "/health" -TargetOriginId $backendOriginId),
        (New-ProxyCacheBehavior -PathPattern "/health/*" -TargetOriginId $backendOriginId),
        (New-ProxyCacheBehavior -PathPattern "/uploads/*" -TargetOriginId $backendOriginId)
    )
}
$distributionConfig.CustomErrorResponses = @{
    Quantity = 0
}

$distributionConfigFile = Write-JsonFile -Name "$distributionId-updated-config.json" -Value $distributionConfig
$distribution = aws cloudfront update-distribution `
    --id $distributionId `
    --if-match $etag `
    --distribution-config "file://$distributionConfigFile" `
    --output json | ConvertFrom-Json
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

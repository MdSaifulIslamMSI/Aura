param(
    [string]$StackPrefix = "aura",
    [string]$AwsRegion = "ap-south-1",
    [string]$AwsProfile = "",
    [string]$BucketName = "",
    [decimal]$MonthlyBudgetUsd = 5,
    [string]$BudgetEmail = "",
    [string]$BudgetName = ""
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
        [int]$Depth = 8
    )

    $path = Join-Path $env:TEMP $Name
    ConvertTo-Json -InputObject $Value -Depth $Depth -Compress | Set-Content -LiteralPath $path -Encoding ascii
    return $path
}

function Ensure-Bucket {
    param(
        [string]$ResolvedBucketName,
        [string]$Region
    )

    try {
        aws s3api head-bucket --bucket $ResolvedBucketName 1>$null 2>$null
        return
    } catch {
    }

    if ($Region -eq "us-east-1") {
        aws s3api create-bucket --bucket $ResolvedBucketName | Out-Null
        return
    }

    aws s3api create-bucket `
        --bucket $ResolvedBucketName `
        --region $Region `
        --create-bucket-configuration "LocationConstraint=$Region" | Out-Null
}

function Configure-FrontendBucket {
    param(
        [string]$ResolvedBucketName,
        [string]$Region,
        [string]$ResolvedStackPrefix
    )

    $ownershipFile = Write-JsonFile -Name "$ResolvedBucketName-ownership.json" -Value @{
        Rules = @(
            @{
                ObjectOwnership = "BucketOwnerEnforced"
            }
        )
    }

    $encryptionFile = Write-JsonFile -Name "$ResolvedBucketName-encryption.json" -Value @{
        Rules = @(
            @{
                ApplyServerSideEncryptionByDefault = @{
                    SSEAlgorithm = "AES256"
                }
            }
        )
    }

    $websiteFile = Write-JsonFile -Name "$ResolvedBucketName-website.json" -Value @{
        IndexDocument = @{
            Suffix = "index.html"
        }
        ErrorDocument = @{
            Key = "index.html"
        }
    }

    $policyFile = Write-JsonFile -Name "$ResolvedBucketName-policy.json" -Value @{
        Version = "2012-10-17"
        Statement = @(
            @{
                Sid = "PublicReadStaticWebsite"
                Effect = "Allow"
                Principal = "*"
                Action = "s3:GetObject"
                Resource = "arn:aws:s3:::$ResolvedBucketName/*"
            }
        )
    }

    $taggingFile = Write-JsonFile -Name "$ResolvedBucketName-tagging.json" -Value @{
        TagSet = @(
            @{
                Key = "App"
                Value = "Aura"
            },
            @{
                Key = "Stack"
                Value = $ResolvedStackPrefix
            },
            @{
                Key = "Purpose"
                Value = "frontend-static-site"
            },
            @{
                Key = "CostProfile"
                Value = "low-spend-s3-static"
            }
        )
    }

    $lifecycleFile = Write-JsonFile -Name "$ResolvedBucketName-lifecycle.json" -Value @{
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
                NoncurrentVersionExpiration = @{
                    NoncurrentDays = 7
                }
            }
        )
    }

    aws s3api put-bucket-ownership-controls `
        --bucket $ResolvedBucketName `
        --ownership-controls "file://$ownershipFile" | Out-Null

    aws s3api put-public-access-block `
        --bucket $ResolvedBucketName `
        --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false" | Out-Null

    aws s3api put-bucket-encryption `
        --bucket $ResolvedBucketName `
        --server-side-encryption-configuration "file://$encryptionFile" | Out-Null

    aws s3api put-bucket-versioning `
        --bucket $ResolvedBucketName `
        --versioning-configuration "Status=Suspended" | Out-Null

    aws s3api put-bucket-lifecycle-configuration `
        --bucket $ResolvedBucketName `
        --lifecycle-configuration "file://$lifecycleFile" | Out-Null

    aws s3api put-bucket-tagging `
        --bucket $ResolvedBucketName `
        --tagging "file://$taggingFile" | Out-Null

    aws s3api put-bucket-website `
        --bucket $ResolvedBucketName `
        --website-configuration "file://$websiteFile" | Out-Null

    aws s3api put-bucket-policy `
        --bucket $ResolvedBucketName `
        --policy "file://$policyFile" | Out-Null
}

function Ensure-FrontendBudget {
    param(
        [string]$AccountId,
        [string]$ResolvedBudgetName,
        [decimal]$ResolvedMonthlyBudgetUsd,
        [string]$EmailAddress
    )

    if ([string]::IsNullOrWhiteSpace($EmailAddress)) {
        return
    }

    $budgetFile = Write-JsonFile -Name "$ResolvedBudgetName-budget.json" -Value @{
        BudgetName = $ResolvedBudgetName
        BudgetLimit = @{
            Amount = $ResolvedMonthlyBudgetUsd.ToString("0.##")
            Unit = "USD"
        }
        BudgetType = "COST"
        TimeUnit = "MONTHLY"
        CostFilters = @{
            TagKeyValue = @("user:Purpose`$frontend-static-site")
        }
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
    }

    $notificationsFile = Write-JsonFile -Name "$ResolvedBudgetName-notifications.json" -Value @(
        @{
            Notification = @{
                NotificationType = "FORECASTED"
                ComparisonOperator = "GREATER_THAN"
                Threshold = 80
                ThresholdType = "PERCENTAGE"
            }
            Subscribers = @(
                @{
                    SubscriptionType = "EMAIL"
                    Address = $EmailAddress
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
                    SubscriptionType = "EMAIL"
                    Address = $EmailAddress
                }
            )
        }
    )

    try {
        aws budgets describe-budget --account-id $AccountId --budget-name $ResolvedBudgetName --region us-east-1 1>$null 2>$null
        $budgetExists = $true
    } catch {
        $budgetExists = $false
    }

    if ($budgetExists) {
        aws budgets update-budget `
            --account-id $AccountId `
            --new-budget "file://$budgetFile" `
            --region us-east-1 | Out-Null
    } else {
        aws budgets create-budget `
            --account-id $AccountId `
            --budget "file://$budgetFile" `
            --notifications-with-subscribers "file://$notificationsFile" `
            --region us-east-1 | Out-Null
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
    "$StackPrefix-frontend-$accountId-$AwsRegion"
} else {
    $BucketName.Trim()
}

$resolvedBudgetName = if ([string]::IsNullOrWhiteSpace($BudgetName)) {
    "$StackPrefix-frontend-s3-monthly-guardrail"
} else {
    $BudgetName.Trim()
}

Ensure-Bucket -ResolvedBucketName $resolvedBucketName -Region $AwsRegion
Configure-FrontendBucket -ResolvedBucketName $resolvedBucketName -Region $AwsRegion -ResolvedStackPrefix $StackPrefix
Ensure-FrontendBudget `
    -AccountId $accountId `
    -ResolvedBudgetName $resolvedBudgetName `
    -ResolvedMonthlyBudgetUsd $MonthlyBudgetUsd `
    -EmailAddress $BudgetEmail

$websiteUrl = "http://$resolvedBucketName.s3-website.$AwsRegion.amazonaws.com"

Write-Host "AWS frontend bucket ready."
Write-Host "Bucket: $resolvedBucketName"
Write-Host "Website URL: $websiteUrl"
Write-Host "Public access: bucket policy allows s3:GetObject for built static files only."
if (-not [string]::IsNullOrWhiteSpace($BudgetEmail)) {
    Write-Host "Budget guardrail: $resolvedBudgetName ($($MonthlyBudgetUsd.ToString("0.##")) USD/month)"
} else {
    Write-Host "Budget guardrail skipped: pass -BudgetEmail to create email alerts."
}

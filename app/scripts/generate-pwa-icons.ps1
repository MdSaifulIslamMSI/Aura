$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function New-AuraIcon {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [int]$Size
    )

    $bitmap = New-Object System.Drawing.Bitmap $Size, $Size
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $background = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Rectangle 0, 0, $Size, $Size),
        ([System.Drawing.Color]::FromArgb(5, 10, 24)),
        ([System.Drawing.Color]::FromArgb(10, 34, 56)),
        45
    )
    $graphics.FillRectangle($background, 0, 0, $Size, $Size)

    $panelSize = [int]($Size * 0.76)
    $panelOffset = [int](($Size - $panelSize) / 2)
    $cornerRadius = [int]($Size * 0.18)

    $panel = New-Object System.Drawing.Drawing2D.GraphicsPath
    $panel.AddArc($panelOffset, $panelOffset, $cornerRadius, $cornerRadius, 180, 90)
    $panel.AddArc($panelOffset + $panelSize - $cornerRadius, $panelOffset, $cornerRadius, $cornerRadius, 270, 90)
    $panel.AddArc($panelOffset + $panelSize - $cornerRadius, $panelOffset + $panelSize - $cornerRadius, $cornerRadius, $cornerRadius, 0, 90)
    $panel.AddArc($panelOffset, $panelOffset + $panelSize - $cornerRadius, $cornerRadius, $cornerRadius, 90, 90)
    $panel.CloseFigure()

    $panelBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Rectangle $panelOffset, $panelOffset, $panelSize, $panelSize),
        ([System.Drawing.Color]::FromArgb(9, 160, 210)),
        ([System.Drawing.Color]::FromArgb(122, 72, 255)),
        315
    )
    $graphics.FillPath($panelBrush, $panel)

    $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(120, 255, 255, 255), [Math]::Max(2, [int]($Size * 0.025)))
    $graphics.DrawPath($borderPen, $panel)

    $fontSize = [Math]::Round($Size * 0.42)
    $font = New-Object System.Drawing.Font('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(245, 255, 255, 255))
    $graphics.DrawString('A', $font, $textBrush, (New-Object System.Drawing.RectangleF 0, 0, $Size, $Size), $format)

    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)

    $textBrush.Dispose()
    $format.Dispose()
    $font.Dispose()
    $borderPen.Dispose()
    $panelBrush.Dispose()
    $panel.Dispose()
    $background.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}

$publicRoot = Split-Path -Parent $PSScriptRoot | Join-Path -ChildPath 'public'
$assetsDir = Join-Path $publicRoot 'assets'

New-AuraIcon -Path (Join-Path $assetsDir 'icon-192.png') -Size 192
New-AuraIcon -Path (Join-Path $assetsDir 'icon-512.png') -Size 512
New-AuraIcon -Path (Join-Path $assetsDir 'favicon-source.png') -Size 64
Copy-Item (Join-Path $assetsDir 'favicon-source.png') (Join-Path $publicRoot 'favicon.ico') -Force
Remove-Item (Join-Path $assetsDir 'favicon-source.png') -Force

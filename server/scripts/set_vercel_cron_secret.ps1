$secret = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$tmp = [System.IO.Path]::GetTempFileName()

try {
    Set-Content -Path $tmp -Value $secret -NoNewline
    cmd /c "type ""$tmp"" | vercel env add CRON_SECRET preview --cwd server"
    cmd /c "type ""$tmp"" | vercel env add CRON_SECRET production --cwd server"
} finally {
    if (Test-Path $tmp) {
        Remove-Item $tmp -Force
    }
}

# Toggle photo-app server: start if stopped, stop if running.
# Updates the desktop shortcut icon to reflect state.

$appDir = "D:\photo-app"
$pidFile = Join-Path $appDir ".server.pid"
$iconDir = Join-Path $appDir "icons"
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "Photo App.lnk"

function Set-ShortcutIcon {
    param([string]$IconPath)
    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut($shortcutPath)
    $lnk.IconLocation = $IconPath
    $lnk.Save()
}

# Check if server is currently running
$running = $false
if (Test-Path $pidFile) {
    $savedPid = [int](Get-Content $pidFile -Raw).Trim()
    try {
        $proc = Get-Process -Id $savedPid -ErrorAction Stop
        if ($proc.ProcessName -eq "node") {
            $running = $true
        }
    } catch {
        # Process no longer exists - clean up stale PID file
        Remove-Item $pidFile -Force
    }
}

if ($running) {
    # Stop the server
    Stop-Process -Id $savedPid -Force
    Remove-Item $pidFile -Force
    Set-ShortcutIcon (Join-Path $iconDir "stopped.ico")
} else {
    # Start the server (hidden window)
    $p = Start-Process -FilePath "node" -ArgumentList "src/server.js" `
        -WorkingDirectory $appDir -WindowStyle Hidden -PassThru
    Set-Content -Path $pidFile -Value $p.Id -NoNewline
    Set-ShortcutIcon (Join-Path $iconDir "running.ico")
}

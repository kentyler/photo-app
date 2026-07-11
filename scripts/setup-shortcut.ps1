# Setup script: creates icons and desktop shortcut for photo-app toggle
# Run once: powershell -ExecutionPolicy Bypass -File scripts/setup-shortcut.ps1

Add-Type -AssemblyName System.Drawing

$appDir = "D:\photo-app"
$iconDir = Join-Path $appDir "icons"

if (!(Test-Path $iconDir)) { New-Item -ItemType Directory -Path $iconDir | Out-Null }

function New-CircleIcon {
    param([string]$Path, [string]$FillColor, [string]$BorderColor)
    $bmp = New-Object System.Drawing.Bitmap(48, 48)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $border = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($BorderColor))
    $g.FillEllipse($border, 4, 4, 40, 40)
    $border.Dispose()

    $fill = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($FillColor))
    $g.FillEllipse($fill, 7, 7, 34, 34)
    $fill.Dispose()
    $g.Dispose()

    $hIcon = $bmp.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($hIcon)
    $fs = [System.IO.FileStream]::new($Path, [System.IO.FileMode]::Create)
    $icon.Save($fs)
    $fs.Close()
    $icon.Dispose()
    $bmp.Dispose()
}

# Green circle = running, gray circle = stopped
New-CircleIcon -Path (Join-Path $iconDir "running.ico") -FillColor "#22c55e" -BorderColor "#16a34a"
New-CircleIcon -Path (Join-Path $iconDir "stopped.ico") -FillColor "#9ca3af" -BorderColor "#6b7280"

Write-Host "Icons created."

# Create desktop shortcut
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "Photo App.lnk"
$toggleScript = Join-Path $appDir "scripts\toggle-server.ps1"

$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($shortcutPath)
$lnk.TargetPath = "powershell.exe"
$lnk.Arguments = "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$toggleScript`""
$lnk.WorkingDirectory = $appDir
$lnk.IconLocation = Join-Path $iconDir "stopped.ico"
$lnk.Description = "Start/Stop Photo App server"
$lnk.Save()

Write-Host "Desktop shortcut created: $shortcutPath"

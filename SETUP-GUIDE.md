# Photo App — LLM Setup Guide

Give this file to an LLM with terminal access (Claude Code, Cursor, Windsurf, etc.) and say:

> "Help me set up this app on my computer. I want a desktop icon I can double-click to start and stop it."

---

## Instructions for the LLM

You are helping a non-technical user set up a family photo browsing app. Walk them through each step one at a time. Confirm each step succeeds before moving to the next. If something goes wrong, help them troubleshoot before continuing.

The end goal: a shortcut on their desktop that toggles the server on/off with a single click, and changes its icon to show whether the server is running.

### What this app does

A local web server for browsing family photos. Photos are stored in a shared Google Drive folder ("lowres"). The database is hosted in the cloud. The app runs on the user's own computer and opens in their web browser at http://localhost:3100.

---

## Phase 1: Install prerequisites

Check what's already installed before downloading anything.

### 1. Node.js (version 18 or later)

Check: `node --version`

If missing:
- **Windows**: Download LTS from https://nodejs.org/ — run the installer with defaults
- **Mac**: `brew install node` (if Homebrew is installed) or download from https://nodejs.org/

After install, confirm `node --version` and `npm --version` both work.

### 2. Git

Check: `git --version`

If missing:
- **Windows**: Download from https://git-scm.com/downloads — install with defaults
- **Mac**: `xcode-select --install` or `brew install git`

### 3. Google Drive for Desktop

This is how photos reach the user's machine. Ask the user:

> "Do you have Google Drive for Desktop installed? When you open File Explorer (Windows) or Finder (Mac), do you see a Google Drive location?"

If not installed:
- Download from https://www.google.com/drive/download/
- Sign in with the Google account that has access to the shared photos
- Wait for initial sync to complete

---

## Phase 2: Clone and install

```bash
git clone https://github.com/kentyler/photo-app.git
cd photo-app
npm install
```

### If `npm install` fails

- **sharp errors on Mac**: Run `npm rebuild sharp`. If that fails: `brew install vips` then `npm install` again.
- **canvas build errors on Mac**: `brew install pkg-config cairo pango libpng jpeg giflib librsvg` then `npm install` again.
- **canvas build errors on Windows**: Install the build tools: `npm install --global windows-build-tools` (from an admin terminal), then `npm install` again.
- **Permission errors**: Don't use `sudo npm install`. Fix npm permissions: https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally

---

## Phase 3: Configure .env

Create a file called `.env` in the photo-app root directory (not in `src/`).

Ask the user for two things:

### A. The lowres folder path

Ask: "I need to find where Google Drive put the shared 'lowres' photo folder on your computer. Can you open File Explorer (or Finder) and navigate to Google Drive? Look for a folder called 'lowres' — it contains subfolders like 'Frances_Oliveira_and_Family' and 'Edwin_Tyler_and_Family'."

Help them find and copy the full path. Examples:
- Windows: `G:/My Drive/lowres` or `N:/My Drive/lowres`
- Mac: `/Volumes/GoogleDrive/My Drive/lowres` or `~/Library/CloudStorage/GoogleDrive-user@gmail.com/My Drive/lowres`

**CRITICAL**: The user must right-click the "lowres" folder in Google Drive and select **"Available offline"** (Windows) or **"Keep on this device"** / **"Make available offline"** (Mac). Without this, Google Drive streams files on-demand and Node.js cannot read them. Photos will show as broken images.

### B. The database password

Ask: "Ken should have given you a database password. Can you tell me what it is?"

If they don't have it, tell them to ask Ken. The setup cannot continue without it.

### Write the .env file

```
LOWRES_ROOT=<the path from step A — use forward slashes, even on Windows>
DB_HOST=35.222.142.30
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD='<the password from step B>'
DB_NAME=photoapp
DB_SSL=require
```

Notes:
- Use forward slashes in LOWRES_ROOT, even on Windows (`G:/My Drive/lowres` not `G:\My Drive\lowres`)
- Wrap DB_PASSWORD in single quotes — it contains special characters
- Do NOT commit this file to git (it's already in .gitignore)

---

## Phase 4: Test the server

```bash
npm start
```

Expected output: `Photo triage UI running at http://localhost:3100`

Open http://localhost:3100 in the user's browser. Confirm photos appear in the grid. If this works, stop the server (Ctrl+C) and proceed to Phase 5.

### If it doesn't work

- **"connection timed out"** or **"ECONNREFUSED"** on the database: The user's IP address needs to be authorized on the cloud database. Ask them to tell Ken their IP address (find it at https://ifconfig.me). Ken needs to add it to the Cloud SQL authorized networks.
- **"FATAL: password authentication failed"**: The password in .env is wrong. Check for extra spaces or missing quotes.
- **"Cannot find module 'dotenv'"**: Run `npm install` again.
- **Photos show as broken images**: The LOWRES_ROOT path is wrong, OR the user didn't set the folder to "Available offline". Verify the path exists by listing it: `ls "<the path>"` — you should see subfolders.
- **Port already in use**: Another process is using port 3100. Either stop it or set `PORT=3101` in .env.

---

## Phase 5: Create the desktop shortcut

This is the final step. Create a desktop icon that:
- Starts the server when clicked (icon turns green)
- Stops the server when clicked again (icon turns gray)
- No terminal window stays open

Detect the platform and follow the appropriate section.

### Windows

The app directory is wherever the user cloned it. Determine this with `pwd` or `cd photo-app && pwd`. Use that path as `$appDir` below.

#### 1. Generate the icons

Create `icons/` directory in the app folder if it doesn't exist. Then run this PowerShell to create two simple .ico files:

```powershell
powershell -ExecutionPolicy Bypass -Command "
Add-Type -AssemblyName System.Drawing
function New-CircleIcon { param([string]\$Path, [string]\$Fill, [string]\$Border)
  \$bmp = New-Object System.Drawing.Bitmap(48,48)
  \$g = [System.Drawing.Graphics]::FromImage(\$bmp)
  \$g.SmoothingMode = 'AntiAlias'; \$g.Clear([System.Drawing.Color]::Transparent)
  \$b = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml(\$Border))
  \$g.FillEllipse(\$b,4,4,40,40); \$b.Dispose()
  \$f = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml(\$Fill))
  \$g.FillEllipse(\$f,7,7,34,34); \$f.Dispose(); \$g.Dispose()
  \$icon = [System.Drawing.Icon]::FromHandle(\$bmp.GetHicon())
  \$fs = [System.IO.FileStream]::new(\$Path,'Create'); \$icon.Save(\$fs)
  \$fs.Close(); \$icon.Dispose(); \$bmp.Dispose() }
New-CircleIcon '<APP_DIR>\icons\running.ico' '#22c55e' '#16a34a'
New-CircleIcon '<APP_DIR>\icons\stopped.ico' '#9ca3af' '#6b7280'
"
```

Replace `<APP_DIR>` with the actual app directory (backslashes for PowerShell paths).

#### 2. Create the toggle script

Write `scripts/toggle-server.ps1` with this content (replace `<APP_DIR>` with the actual path using backslashes):

```powershell
$appDir = "<APP_DIR>"
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

$running = $false
if (Test-Path $pidFile) {
    $savedPid = [int](Get-Content $pidFile -Raw).Trim()
    try {
        $proc = Get-Process -Id $savedPid -ErrorAction Stop
        if ($proc.ProcessName -eq "node") { $running = $true }
    } catch { Remove-Item $pidFile -Force }
}

if ($running) {
    Stop-Process -Id $savedPid -Force
    Remove-Item $pidFile -Force
    Set-ShortcutIcon (Join-Path $iconDir "stopped.ico")
} else {
    $p = Start-Process -FilePath "node" -ArgumentList "src/server.js" `
        -WorkingDirectory $appDir -WindowStyle Hidden -PassThru
    Set-Content -Path $pidFile -Value $p.Id -NoNewline
    Set-ShortcutIcon (Join-Path $iconDir "running.ico")
}
```

#### 3. Create the desktop shortcut

```powershell
powershell -ExecutionPolicy Bypass -Command "
\$shell = New-Object -ComObject WScript.Shell
\$lnk = \$shell.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Photo App.lnk')
\$lnk.TargetPath = 'powershell.exe'
\$lnk.Arguments = '-ExecutionPolicy Bypass -WindowStyle Hidden -File \"<APP_DIR>\scripts\toggle-server.ps1\"'
\$lnk.WorkingDirectory = '<APP_DIR>'
\$lnk.IconLocation = '<APP_DIR>\icons\stopped.ico'
\$lnk.Description = 'Start/Stop Photo App server'
\$lnk.Save()
"
```

### Mac

#### 1. Create the toggle script

Write `scripts/toggle-server.sh` (replace `<APP_DIR>` with the actual path):

```bash
#!/bin/bash
APP_DIR="<APP_DIR>"
PID_FILE="$APP_DIR/.server.pid"
RUNNING_ICON="$APP_DIR/icons/running.png"
STOPPED_ICON="$APP_DIR/icons/stopped.png"
APP_BUNDLE="$HOME/Desktop/Photo App.app"

update_icon() {
    cp "$1" "$APP_BUNDLE/Contents/Resources/app.icns" 2>/dev/null
    touch "$APP_BUNDLE"  # force Finder to refresh
}

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
        kill "$PID"
        rm -f "$PID_FILE"
        update_icon "$STOPPED_ICON"
        exit 0
    else
        rm -f "$PID_FILE"
    fi
fi

cd "$APP_DIR"
nohup node src/server.js > /dev/null 2>&1 &
echo $! > "$PID_FILE"
update_icon "$RUNNING_ICON"
```

Make it executable: `chmod +x scripts/toggle-server.sh`

#### 2. Generate icons

Create `icons/` directory, then generate simple PNG icons for the Mac .app bundle:

```bash
# Requires sips (built into macOS)
# Green circle (running)
python3 -c "
from PIL import Image, ImageDraw
img = Image.new('RGBA', (256, 256), (0,0,0,0))
d = ImageDraw.Draw(img)
d.ellipse([20,20,236,236], fill='#22c55e', outline='#16a34a', width=8)
img.save('<APP_DIR>/icons/running.png')
"

# Gray circle (stopped)
python3 -c "
from PIL import Image, ImageDraw
img = Image.new('RGBA', (256, 256), (0,0,0,0))
d = ImageDraw.Draw(img)
d.ellipse([20,20,236,236], fill='#9ca3af', outline='#6b7280', width=8)
img.save('<APP_DIR>/icons/stopped.png')
"
```

If Python PIL/Pillow is not available, skip the icon generation — the app will work without icon toggling. Or install: `pip3 install Pillow`

For the .app's actual icon (.icns format), convert: `sips -s format icns icons/stopped.png --out icons/app.icns`

#### 3. Create the .app bundle

macOS uses .app bundles (which are just folders with a specific structure). Create one on the Desktop:

```bash
APP="$HOME/Desktop/Photo App.app"
mkdir -p "$APP/Contents/MacOS"
mkdir -p "$APP/Contents/Resources"

# The launcher just calls the toggle script
cat > "$APP/Contents/MacOS/PhotoApp" << 'SCRIPT'
#!/bin/bash
DIR="$(dirname "$0")/../../.."
"<APP_DIR>/scripts/toggle-server.sh"
SCRIPT
chmod +x "$APP/Contents/MacOS/PhotoApp"

# Info.plist
cat > "$APP/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>Photo App</string>
    <key>CFBundleExecutable</key>
    <string>PhotoApp</string>
    <key>CFBundleIconFile</key>
    <string>app.icns</string>
    <key>CFBundleIdentifier</key>
    <string>com.family.photoapp</string>
    <key>CFBundleVersion</key>
    <string>1.0</string>
</dict>
</plist>
PLIST

# Copy initial icon
cp "<APP_DIR>/icons/app.icns" "$APP/Contents/Resources/app.icns" 2>/dev/null
```

---

## Phase 6: Verify the desktop shortcut

1. Ask the user to double-click the "Photo App" icon on their desktop
2. Wait a few seconds, then open http://localhost:3100 in their browser
3. Photos should appear
4. Ask them to double-click the icon again — the server should stop
5. Refresh the browser — it should fail to connect (confirming the server stopped)

Tell the user:
- **Gray icon** = server is off. Click to start.
- **Green icon** = server is running. Click to stop. Browse photos at http://localhost:3100.
- They can bookmark http://localhost:3100 in their browser for easy access.

---

## Phase 7: Auto-open browser (optional)

If the user wants the browser to open automatically when they start the server, add this line to the toggle script:

- **Windows** (in the `else` block of toggle-server.ps1, after Start-Process):
  ```powershell
  Start-Process "http://localhost:3100"
  ```
- **Mac** (in toggle-server.sh, after the nohup line):
  ```bash
  sleep 2 && open "http://localhost:3100"
  ```

---

## Updating the app

When Ken pushes updates:
```bash
cd <APP_DIR>
git pull
npm install
```

Then click the desktop icon to restart the server.

---

## Troubleshooting reference

| Symptom | Cause | Fix |
|---------|-------|-----|
| Broken images | LOWRES_ROOT wrong or folder not set to "Available offline" | Verify path, right-click folder > "Available offline" |
| "connection timed out" | IP not authorized on cloud DB | User tells Ken their IP (https://ifconfig.me) |
| "password authentication failed" | Wrong password in .env | Check with Ken for correct password |
| Server won't start, port in use | Another process on 3100 | `lsof -i :3100` (Mac) or `netstat -ano | findstr 3100` (Windows) to find and kill it |
| `npm install` fails (sharp) | Missing native dependencies | Mac: `brew install vips`. Windows: install Visual Studio Build Tools |
| `npm install` fails (canvas) | Missing native dependencies | Mac: `brew install pkg-config cairo pango libpng jpeg giflib librsvg` |
| Desktop icon doesn't change | Icon cache | Windows: restart Explorer. Mac: `touch "$HOME/Desktop/Photo App.app"` |
| Clicked icon but nothing happens | Node not in PATH | Run `which node` or `where node`. If missing, reinstall Node.js and restart terminal |
| Mac: "app is damaged" warning | Gatekeeper blocks unsigned apps | `xattr -cr "$HOME/Desktop/Photo App.app"` |

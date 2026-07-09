# Photo App Setup Guide

Give this file to an LLM (Claude, ChatGPT, etc.) and say: "Help me set up this app on my computer."

---

## Instructions for the LLM

You are helping a non-technical user set up a family photo browsing app on their computer. Walk them through each step one at a time. Confirm each step succeeds before moving to the next. If something goes wrong, help them troubleshoot.

### What this app does
A local web app for browsing family photos. The photos are stored in a shared Google Drive folder. The database is hosted in the cloud. The app runs on the user's own computer and opens in their web browser.

### Prerequisites to install

1. **Node.js** (version 18 or later)
   - Download from https://nodejs.org/ (use the LTS version)
   - After install, confirm by opening a terminal and running: `node --version`

2. **Git** (to download the app)
   - Download from https://git-scm.com/downloads
   - After install, confirm: `git --version`

3. **Google Drive for Desktop**
   - Download from https://www.google.com/drive/download/
   - Sign in with the Google account that has access to the shared "lowres" folder
   - Wait for it to sync. The shared folder should appear as a drive letter (Windows) or under /Volumes (Mac)

### Setup steps

1. **Clone the repository**
   ```
   git clone https://github.com/kentyler/photo-app.git
   cd photo-app
   npm install
   ```

2. **Find the lowres folder path**
   - Open File Explorer (Windows) or Finder (Mac)
   - Navigate to Google Drive > find the "lowres" folder
   - Copy the full path. Examples:
     - Windows: `G:/My Drive/lowres` or `N:/My Drive/lowres`
     - Mac: `/Volumes/GoogleDrive/My Drive/lowres`
   - Help the user find this path if they're unsure. The folder contains subfolders like `Frances_Oliveira_and_Family`, `Edwin_Tyler_and_Family`, `KenAndConnie`.

3. **Create the .env file**
   - Create a file called `.env` in the `photo-app` folder (not in `src/`, in the root)
   - It must contain exactly this (replace the LOWRES_ROOT path with what the user found in step 2):

   ```
   LOWRES_ROOT=G:/My Drive/lowres
   DB_HOST=35.222.142.30
   DB_PORT=5432
   DB_USER=postgres
   DB_PASSWORD=N9ykrv1o8!
   DB_NAME=photoapp
   DB_SSL=require
   ```

   IMPORTANT: Use forward slashes in the LOWRES_ROOT path, even on Windows.

4. **Start the app**
   ```
   npm start
   ```
   They should see: `Photo triage UI running at http://localhost:3100`

5. **Open in browser**
   - Go to http://localhost:3100
   - Photos should appear in the grid

### Troubleshooting

- **"Cannot find module 'dotenv'"** — Run `npm install` again
- **Photos show as broken images** — The LOWRES_ROOT path is wrong. Help them find the correct path to the lowres folder on their Google Drive.
- **"connection timed out" or database errors** — Their IP address may not be authorized on the cloud database. Ask them to contact Ken to add their IP. They can find their IP at https://ifconfig.me
- **"FATAL: password authentication failed"** — Check that the .env file has the correct password with no extra spaces
- **App won't start on Mac** — They may need to use `node src/server.js` instead of `npm start`, or install sharp dependencies: `npm rebuild sharp`

### Stopping and restarting

- To stop: press Ctrl+C in the terminal
- To restart: run `npm start` again from the photo-app folder
- The app only runs while the terminal is open

### Updating

To get the latest version:
```
cd photo-app
git pull
npm install
npm start
```

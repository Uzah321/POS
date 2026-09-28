# =============================================================
# NexaPOS — Deploy from this PC to the VPS (PowerShell version of deploy-vps.sh)
#
# Pushes main to GitHub, then SSHes into the VPS and runs the
# server-side update (update.sh / nexapos-update), which pulls the
# code, runs migrations, rebuilds the frontend and restarts services.
#
#   .\deploy-vps.ps1              # push + deploy
#   .\deploy-vps.ps1 -SetupKey    # one-time: log in with an SSH key
#                                 # instead of typing the password
#
# No passwords are stored here: SSH and sudo ask for them when needed.
# If PowerShell refuses to run scripts, use:
#   powershell -ExecutionPolicy Bypass -File .\deploy-vps.ps1
# =============================================================
param(
    [switch]$SetupKey,
    [string]$VpsHost = '208.110.72.189',
    [string]$VpsUser = 'administrator',
    [string]$AppDir  = '/var/www/nexapos',
    [string]$Branch  = 'main'
)

$Target = "$VpsUser@$VpsHost"

function Info($msg)  { Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Ok($msg)    { Write-Host "[OK] $msg" -ForegroundColor Green }
function Warn($msg)  { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Fail($msg)  { Write-Host "[ERROR] $msg" -ForegroundColor Red; exit 1 }

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) { Fail 'ssh is not installed (Windows Settings > Optional features > OpenSSH Client)' }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'git is not installed' }

# ── One-time SSH key setup ───────────────────────────────────
if ($SetupKey) {
    $key = Join-Path $env:USERPROFILE '.ssh\id_ed25519'
    if (-not (Test-Path $key)) {
        Info "Creating an SSH key at $key..."
        New-Item -ItemType Directory -Force (Split-Path $key) | Out-Null
        ssh-keygen -t ed25519 -f $key -N '""' -C 'nexapos-deploy'
        if ($LASTEXITCODE -ne 0) { Fail 'ssh-keygen failed' }
    }
    Info "Adding the key to $Target (enter the server password once)..."
    Get-Content "$key.pub" | ssh $Target 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'
    if ($LASTEXITCODE -ne 0) { Fail 'Could not add the key to the server' }
    Ok "Key installed - future deploys won't ask for the SSH password"
    exit 0
}

# ── Push to GitHub ───────────────────────────────────────────
Set-Location $PSScriptRoot

$currentBranch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($currentBranch -ne $Branch) { Fail "On branch '$currentBranch' - switch to '$Branch' first (the server deploys $Branch)" }

$dirty = git status --porcelain --untracked-files=no
if ($dirty) {
    Warn 'You have uncommitted changes - they will NOT be deployed:'
    git status --short --untracked-files=no
    $answer = Read-Host 'Continue anyway? [y/N]'
    if ($answer -notmatch '^[Yy]$') { exit 1 }
}

Info "Pushing $Branch to GitHub..."
git push origin $Branch
if ($LASTEXITCODE -ne 0) { Fail 'git push failed - pull first if GitHub has newer commits' }
$commit = (git rev-parse --short HEAD).Trim()
Ok "Pushed $commit"

# ── Run the update on the VPS ────────────────────────────────
# -t gives sudo a terminal so it can ask for the password there.
Info "Deploying $commit to $Target..."
ssh -t $Target "if command -v nexapos-update >/dev/null 2>&1; then sudo nexapos-update; else sudo bash '$AppDir/update.sh'; fi"
if ($LASTEXITCODE -ne 0) { Fail 'The update on the server failed - see the output above' }

Ok "Deployed $commit to $VpsHost"

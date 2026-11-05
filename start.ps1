# One-command launch for Windows. Safe to run repeatedly: finished steps are skipped.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"
$python = Join-Path $backend ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    Write-Host "Creating the Python environment..."
    python -m venv (Join-Path $backend ".venv")
    if ($LASTEXITCODE -ne 0) { throw "Could not create a virtual environment. Is Python 3.12 installed?" }
}

$stamp = Join-Path $backend ".venv\.requirements-installed"
$requirements = Join-Path $backend "requirements.txt"
if (-not (Test-Path $stamp) -or (Get-Item $requirements).LastWriteTime -gt (Get-Item $stamp).LastWriteTime) {
    Write-Host "Installing Python packages. The first time takes a few minutes..."
    & $python -m pip install --quiet --disable-pip-version-check -r $requirements
    if ($LASTEXITCODE -ne 0) { throw "Installing Python packages failed." }
    New-Item -ItemType File -Force $stamp | Out-Null
}

if (-not (Test-Path (Join-Path $frontend "node_modules"))) {
    Write-Host "Installing interface packages..."
    npm --prefix $frontend ci
    if ($LASTEXITCODE -ne 0) { throw "npm install failed. Is Node 20 or newer installed?" }
}

if (-not (Test-Path (Join-Path $frontend "dist\index.html"))) {
    Write-Host "Building the interface..."
    npm --prefix $frontend run build
    if ($LASTEXITCODE -ne 0) { throw "Building the interface failed." }
}

Write-Host ""
Write-Host "QANTUM is starting at http://127.0.0.1:8000"
Write-Host "Press Ctrl+C to stop."
Set-Location $backend
& $python -m qantum

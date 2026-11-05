# Publishes QANTUM to a Hugging Face Space. Log in first with: hf auth login
param([Parameter(Mandatory)][string]$User, [string]$Space = "qantum")
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot)
$repo = "$User/$Space"
hf repos create $repo --type space --sdk docker --exist-ok
hf upload $repo . . --type space --exclude "**/.venv/**" --exclude "**/node_modules/**" --exclude "frontend/dist/**" --exclude ".git/**" --exclude ".claude/**" --exclude "docs/**" --exclude "**/__pycache__/**" --exclude "**/.pytest_cache/**" --exclude "*.pdf" --exclude "*.docx" --exclude "backend/*.db*" --exclude "README.md" --commit-message "Deploy QANTUM"
hf upload $repo deploy/space-README.md README.md --type space --commit-message "Space settings"
Write-Host "Building now. Watch it at https://huggingface.co/spaces/$repo"

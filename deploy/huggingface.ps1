# Publishes QANTUM as a free Static Space. Log in first with: hf auth login
param([Parameter(Mandatory)][string]$User, [string]$Space = "qantum")
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot
$env:VITE_STATIC = "1"
npm --prefix "$root/frontend" run build
Remove-Item Env:VITE_STATIC
Push-Location "$root/backend"
& .venv/Scripts/python -m qantum.export_static
Pop-Location
Copy-Item "$root/deploy/space-README.md" "$root/frontend/dist/README.md"
$repo = "$User/$Space"
hf repos create $repo --type space --sdk static --exist-ok
# Through Python, because the hf command expands wildcards itself on Windows.
python -c "import sys; from huggingface_hub import HfApi; HfApi().upload_folder(repo_id=sys.argv[1], repo_type='space', folder_path=sys.argv[2], delete_patterns='*', commit_message='Deploy QANTUM')" $repo "$root/frontend/dist"
Write-Host "Live soon at https://huggingface.co/spaces/$repo"

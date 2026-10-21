$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
python -m pip install pyinstaller==6.16.0
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller installation failed' }
python -m PyInstaller --onefile --name PersonnelWeb --add-data 'web;web' server.py
if ($LASTEXITCODE -ne 0) { throw 'Application build failed' }
Write-Host 'Ready: dist/PersonnelWeb.exe. Run with --open to open the interface.'

# Start Epic's Pixel Streaming signalling server on ws://0.0.0.0:8888
# Usage: .\start-signalling.ps1 [-Dir C:\PixelStreamingInfrastructure]
param(
  [string]$Dir = "$HOME\PixelStreamingInfrastructure",
  [string]$Branch = "UE5.5"
)
$ErrorActionPreference = "Stop"

if (-not (Test-Path (Join-Path $Dir ".git"))) {
  Write-Host "-> cloning EpicGames/PixelStreamingInfrastructure ($Branch) into $Dir"
  git clone --depth 1 --branch $Branch https://github.com/EpicGames/PixelStreamingInfrastructure.git $Dir
}

Set-Location (Join-Path $Dir "SignallingWebServer\platform_scripts\cmd")
& .\setup.bat
Write-Host "-> signalling server starting on ws://localhost:8888 (Ctrl+C to stop)"
& .\start.bat

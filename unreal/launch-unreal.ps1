# Launch an Unreal Engine project straight into a Pixel Streaming session.
# Usage: .\launch-unreal.ps1 -Project C:\Games\MyGame.uproject [-Url ws://127.0.0.1:8888] [-Res 1920x1080]
param(
  [Parameter(Mandatory = $true)][string]$Project,
  [string]$Url = "ws://127.0.0.1:8888",
  [string]$Res = "1920x1080",
  [string]$EngineRoot = "C:\Program Files\Epic Games\UE_5.5"
)
$ErrorActionPreference = "Stop"
$editor = Join-Path $EngineRoot "Engine\Binaries\Win64\UnrealEditor.exe"
if (-not (Test-Path $editor)) { throw "UnrealEditor.exe not found under $EngineRoot (pass -EngineRoot)" }

$parts = $Res.Split("x")
Write-Host "-> engine: $editor"
Write-Host "-> signalling: $Url"
& $editor $Project -game "-PixelStreamingURL=$Url" -RenderOffScreen -ForceRes "-ResX=$($parts[0])" "-ResY=$($parts[1])" -Windowed -log

param(
  [string]$OutputDirectory = ".\backups",
  [string]$ComposeFile = ".\infra\docker-compose.yml"
)
$ErrorActionPreference = "Stop"
$resolvedRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$outputPath = [System.IO.Path]::GetFullPath((Join-Path $resolvedRoot $OutputDirectory))
if (-not $outputPath.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Backup output must stay inside the repository: $outputPath"
}
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$target = Join-Path $outputPath "a2a-platform-$stamp.dump"
$composePath = [System.IO.Path]::GetFullPath((Join-Path $resolvedRoot $ComposeFile))
docker compose -f $composePath exec -T postgres pg_dump -U platform -d a2a_platform -Fc --no-owner --no-acl | Set-Content -AsByteStream -LiteralPath $target
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed with exit code $LASTEXITCODE" }
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$target.sha256" -Value "$hash  $([System.IO.Path]::GetFileName($target))`n"
Write-Output $target

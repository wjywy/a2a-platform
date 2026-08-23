param(
  [Parameter(Mandatory = $true)][string]$BackupFile,
  [string]$ComposeFile = ".\infra\docker-compose.yml",
  [switch]$ConfirmRestore
)
$ErrorActionPreference = "Stop"
if (-not $ConfirmRestore) { throw "Restore overwrites the platform database. Re-run with -ConfirmRestore." }
$resolvedRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$backupPath = (Resolve-Path -LiteralPath $BackupFile).Path
if (-not $backupPath.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Backup file must be located inside the repository: $backupPath"
}
$composePath = [System.IO.Path]::GetFullPath((Join-Path $resolvedRoot $ComposeFile))
Get-Content -AsByteStream -Raw -LiteralPath $backupPath | docker compose -f $composePath exec -T postgres pg_restore -U platform -d a2a_platform --clean --if-exists --no-owner --no-acl
if ($LASTEXITCODE -ne 0) { throw "pg_restore failed with exit code $LASTEXITCODE" }
Write-Output "Restore completed from $backupPath"

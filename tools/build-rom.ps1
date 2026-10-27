# Assembles a Decathlon disassembly with DASM and checks the result's MD5
# against the cartridge (525f2dfc8b21b0186cff2568e0509bfc).
# usage: tools/build-rom.ps1 [source.asm]   (default: tools/build/decathlon_raw.asm)
# Output: tools/build/decathlon.{bin,lst,sym} (git-ignored).
# DASM runs in a temp folder because Windows' Controlled Folder Access stops
# it writing under Documents; the results are copied back afterwards.
param([string]$Source = (Join-Path $PSScriptRoot 'build\decathlon_raw.asm'))
$ErrorActionPreference = 'Stop'
$out = Join-Path $PSScriptRoot 'build'
New-Item -ItemType Directory -Force $out | Out-Null
$tmp = Join-Path ([IO.Path]::GetTempPath()) 'space-shuttle-rom-build'
New-Item -ItemType Directory -Force $tmp | Out-Null
Copy-Item $Source (Join-Path $tmp 'decathlon.asm') -Force
Copy-Item (Join-Path $PSScriptRoot 'dasm\vcs.h') $tmp -Force
Copy-Item (Join-Path $PSScriptRoot 'dasm\macro.h') $tmp -Force
Push-Location $tmp
try {
  # passed as an array: PowerShell mangles some DASM flags written inline
  $dasmArgs = @('decathlon.asm', '-f3', '-odecathlon.bin', '-ldecathlon.lst', '-sdecathlon.sym')
  & (Join-Path $PSScriptRoot 'dasm\dasm.exe') @dasmArgs
  if ($LASTEXITCODE -ne 0) { throw "DASM failed ($LASTEXITCODE)" }
} finally { Pop-Location }
foreach ($f in 'decathlon.bin', 'decathlon.lst', 'decathlon.sym') { Copy-Item (Join-Path $tmp $f) $out -Force }
$md5 = (Get-FileHash (Join-Path $out 'decathlon.bin') -Algorithm MD5).Hash.ToLower()
if ($md5 -eq '525f2dfc8b21b0186cff2568e0509bfc') { Write-Output "OK: byte-identical to the cartridge ($md5)" }
else { Write-Output "MISMATCH: $md5"; exit 1 }

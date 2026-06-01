const { execSync } = require('child_process');
const path = require('path');

const root = 'D:\\Reasonix\\Reasonix\\红中宝';
const out = 'D:\\Reasonix\\Reasonix\\hongzhongbao.zip';

// Use PowerShell to zip with specific excludes
const cmd = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open('${out}', [System.IO.Compression.ZipArchiveMode]::Create)
$root = '${root}'

# Add all files recursively, excluding node_modules
Get-ChildItem $root -Recurse -File | Where-Object {
  $_.FullName -notmatch '\\\\node_modules\\\\' -and
  $_.FullName -notmatch '\\\\.git\\\\'
} | ForEach-Object {
  $rel = $_.FullName.Substring($root.Length + 1)
  $entry = $zip.CreateEntryFromFile($_.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal)
}
$zip.Dispose()
Write-Host "Done"
`;
require('fs').writeFileSync('_zip.ps1', cmd, 'utf8');
console.log('Script written');

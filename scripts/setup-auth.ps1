$ErrorActionPreference = 'Stop'

# Windows PowerShell 5.1은 BOM 없는 UTF-8 스크립트의 한글 리터럴을 시스템 ANSI로
# 오해할 수 있다. 비밀번호 입력 화면만큼은 어떤 Windows에서도 깨지지 않게 ASCII로 둔다.
$username = Read-Host 'Login username (letters/numbers/._@-, max 64)'
$password1 = Read-Host 'Login password (8+ characters)' -AsSecureString
$password2 = Read-Host 'Confirm password' -AsSecureString

function Convert-SecureToPlain([Security.SecureString]$Value) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

$plain1 = Convert-SecureToPlain $password1
$plain2 = Convert-SecureToPlain $password2
try {
  if ($plain1 -cne $plain2) { throw 'Passwords do not match.' }
  $payload = @{ username = $username; password = $plain1 } | ConvertTo-Json -Compress
  $payload | & node (Join-Path $PSScriptRoot 'setup-auth.mjs')
  if ($LASTEXITCODE -ne 0) { throw "Authentication setup failed with exit code $LASTEXITCODE." }
}
finally {
  $plain1 = $null
  $plain2 = $null
  $payload = $null
}

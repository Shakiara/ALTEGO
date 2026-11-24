# ALTEGO necesita resolver el cierre de procesos propios sin afectar PID reutilizados.
# Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
param([Parameter(Mandatory=$true)][int]$TargetPid,[Parameter(Mandatory=$true)][string]$ExpectedCreation)
$ErrorActionPreference = 'Stop'
try { $target = [Diagnostics.Process]::GetProcessById($TargetPid) } catch [ArgumentException] { exit 0 }
try {

    $handle = $target.Handle
    if ($target.ProcessName -notin @('node','esbuild','Altego.DevConsole')) { throw 'Refusing an executable not managed by ALTEGO.' }
    $actual = [DateTimeOffset]::new($target.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds()
    $expected = [DateTimeOffset]::Parse($ExpectedCreation).ToUnixTimeMilliseconds()
    if ($actual -ne $expected) { exit 0 }
    $target.Kill()
    if (-not $target.WaitForExit(4000)) { throw 'Owned process did not exit.' }
} finally { $target.Dispose() }

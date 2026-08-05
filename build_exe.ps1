# build_exe.ps1
# PowerShell script to build APIFlow Labeler into a Windows executable (.exe)

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " Building APIFlow Labeler Executable (PyInstaller) " -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

$VENV_PYTHON = ".\backend\venv\Scripts\python.exe"
$VENV_PYINSTALLER = ".\backend\venv\Scripts\pyinstaller.exe"

# Fallback to system pyinstaller if virtualenv binary is not found directly
if (Test-Path $VENV_PYINSTALLER) {
    $PYINSTALLER_CMD = $VENV_PYINSTALLER
} else {
    $PYINSTALLER_CMD = "pyinstaller"
}

Write-Host "Running PyInstaller using: $PYINSTALLER_CMD" -ForegroundColor Yellow

& $PYINSTALLER_CMD --noconfirm apiflow_labeler.spec

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n==================================================" -ForegroundColor Green
    Write-Host " BUILD SUCCESSFUL!" -ForegroundColor Green
    Write-Host " Executable folder created at: dist\APIFlowLabeler\" -ForegroundColor Green
    Write-Host " Launch application with: dist\APIFlowLabeler\APIFlowLabeler.exe" -ForegroundColor Green
    Write-Host "==================================================" -ForegroundColor Green
} else {
    Write-Host "`n==================================================" -ForegroundColor Red
    Write-Host " BUILD FAILED! Check error log above." -ForegroundColor Red
    Write-Host "==================================================" -ForegroundColor Red
}

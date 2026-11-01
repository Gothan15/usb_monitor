# -*- mode: python ; coding: utf-8 -*-
import os
# Spec de PyInstaller para el proceso compañero (usb_prompt.py).
# Genera USBMonitorPrompt.exe (sin consola: es una ventana de sesión
# de usuario). Compilar con build_usb_prompt_pyinstaller.ps1.

a = Analysis(
    [os.path.join(SPECPATH, '..', 'usb_prompt.py')],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='USBMonitorPrompt',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=os.path.join(SPECPATH, '..', 'usb_monitor_service.ico'),
)

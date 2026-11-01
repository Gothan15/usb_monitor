# -*- mode: python ; coding: utf-8 -*-
import os
# Spec de PyInstaller para el visor de seriales (usb_serial_viewer.py).
# Genera USBSerialViewer.exe (sin consola: es una ventana de
# escritorio). Compilar con build_usb_serial_viewer_pyinstaller.ps1.
# Este archivo faltaba en el repo: el script de compilación lo
# referenciaba y sin él el visor no se podía construir desde un
# clon limpio.

a = Analysis(
    [os.path.join(SPECPATH, '..', 'usb_serial_viewer.py')],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=['wmi', 'pythoncom', 'pywintypes', 'win32com', 'webview', 'fluent_ui'],
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
    name='USBSerialViewer',
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

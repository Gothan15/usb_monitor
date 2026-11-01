# -*- mode: python ; coding: utf-8 -*-
import os
# Spec de PyInstaller para la herramienta de administración
# (usb_monitor_admin.py: configurar la clave API de un equipo y
# utilidades manuales). Genera USBMonitorAdmin.exe (sin consola:
# es una ventana). Compilar con build_usb_monitor_admin_pyinstaller.ps1.
# La herramienta importa los ayudantes del propio servicio; el
# análisis de PyInstaller los incluye siguiendo ese import.

a = Analysis(
    [os.path.join(SPECPATH, '..', 'usb_monitor_admin.py')],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=['wmi', 'pythoncom', 'pywintypes', 'win32com', 'win32timezone'],
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
    name='USBMonitorAdmin',
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
)

# -*- mode: python ; coding: utf-8 -*-
import os
# Spec de PyInstaller para el servicio (usb_monitor_service.py).
# Genera USBMonitorService.exe. Compilar con
# build_usb_monitor_service_pyinstaller.ps1.
# Los imports ocultos son los módulos de pywin32 que el servicio usa
# para hablar con el SCM de Windows: PyInstaller no los descubre
# solo y sin ellos el exe muere al arrancar buscándolos.

a = Analysis(
    [os.path.join(SPECPATH, '..', 'usb_monitor_service.py')],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[
        'win32serviceutil',
        'win32service',
        'win32event',
        'servicemanager',
        'pythoncom',
        'pywintypes',
        'wmi',
        'win32com',
        'win32timezone',
    ],
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
    name='USBMonitorService',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

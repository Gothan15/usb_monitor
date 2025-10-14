# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path


project_dir = Path.cwd()
icon_file = project_dir / "usb_monitor_service.ico"

a = Analysis(
    ['usb_monitor_service.py'],
    pathex=[str(project_dir)],
    binaries=[],
    datas=[],
    hiddenimports=['win32timezone', 'servicemanager', 'pythoncom'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
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
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(icon_file),
)

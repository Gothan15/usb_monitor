# -*- mode: python ; coding: ascii -*-

from pathlib import Path

project_dir = Path.cwd()


a = Analysis(
    ['usb_serial_viewer.py'],
    pathex=[str(project_dir)],
    binaries=[],
    datas=[],
    hiddenimports=[
        'pythoncom',
        'pywintypes',
        'win32com',
        'win32com.client',
        'win32timezone',
        'wmi',
    ],
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
    icon=None,
)

# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all

datas = [('.venv/Lib/site-packages/customtkinter/assets', 'customtkinter/assets'), ('VERSION', '.'), ('assets/app-logo.png', 'assets')]
binaries = []
psutil_datas, psutil_binaries, psutil_hiddenimports = collect_all('psutil')
pynput_datas, pynput_binaries, pynput_hiddenimports = collect_all('pynput')
tmp_ret = collect_all('customtkinter')
datas += psutil_datas + pynput_datas + tmp_ret[0]
binaries += psutil_binaries + pynput_binaries + tmp_ret[1]
hiddenimports = psutil_hiddenimports + pynput_hiddenimports + tmp_ret[2]


a = Analysis(
    ['app/main.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
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
    [],
    exclude_binaries=True,
    name='RigwedaMonitor',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='RigwedaMonitor',
)

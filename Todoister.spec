# -*- mode: python ; coding: utf-8 -*-
# PyInstaller build recipe for Todoister (pywebview + WebView2 native app).
# Build:  python -m PyInstaller --clean --noconfirm Todoister.spec
from PyInstaller.utils.hooks import collect_all, collect_submodules

# Read-only resources the app serves (land in the bundle dir = RES_DIR/_MEIPASS).
datas = [
    ('index.html', '.'),
    ('app.css', '.'),
    ('js', 'js'),
    ('onboarding.html', '.'),
    ('i18n.js', '.'),
    ('assets', 'assets'),
    ('lang', 'lang'),
    ('notebook-assets', 'notebook-assets'),
    ('guide', 'guide'),      # in-app help topics (was missing — installed app showed only the GUIDE.md fallback)
    ('GUIDE.md', '.'),       # build_guide_page's last-resort fallback
]
binaries = []
hiddenimports = ['paths', 'server', 'sync', 'store', 'pages', 'gcal_sync', 'gcal', 'gcal_api', 'nb_files']

# pywebview + its .NET/WebView2 backend need their data + binaries collected.
for pkg in ('webview', 'clr_loader'):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h
hiddenimports += collect_submodules('pythonnet') + ['clr']

a = Analysis(
    ['app.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Todoister',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    icon='assets\\icon.ico',
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name='Todoister',
)

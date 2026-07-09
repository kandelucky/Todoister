# -*- coding: utf-8 -*-
"""Resource vs. user-data paths — works in dev and in a PyInstaller build.

RES_DIR  : read-only bundled files (index.html, onboarding.html, icons,
           assets, lang, notebook-assets). In a frozen build this is the
           bundle dir (sys._MEIPASS).
DATA_DIR : writable user data (triage.db, .env, logs, exports). In a frozen
           build this is %APPDATA%\\Todoister, so it survives reinstalls and
           works when the app is installed read-only (Program Files / per-user).

In dev (not frozen) both resolve to this folder, so behaviour is unchanged.
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))


def _res_dir():
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    return _HERE


def _data_dir():
    if getattr(sys, "frozen", False):
        root = os.environ.get("APPDATA") or os.path.expanduser("~")
        base = os.path.join(root, "Todoister")
    else:
        base = _HERE
    os.makedirs(base, exist_ok=True)
    return base


RES_DIR = _res_dir()
DATA_DIR = _data_dir()

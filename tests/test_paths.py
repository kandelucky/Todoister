# -*- coding: utf-8 -*-
"""Unit tests for paths.py — resource vs. user-data path resolution.

Runner: pytest. Dev-only — never bundled into the installer (the app never
imports the tests, so PyInstaller can't sweep them in).
"""
import os
import sys

import paths


# ───────── dev mode (not frozen): both resolve to the source folder ─────────

def test_dev_res_is_source_folder(monkeypatch):
    monkeypatch.delattr(sys, "frozen", raising=False)
    assert paths._res_dir() == paths._HERE


def test_dev_data_is_source_folder(monkeypatch):
    monkeypatch.delattr(sys, "frozen", raising=False)
    assert paths._data_dir() == paths._HERE


# ───────── frozen build: resources come from the bundle dir ─────────

def test_frozen_res_uses_meipass(monkeypatch):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", r"C:\bundle\app", raising=False)
    assert paths._res_dir() == r"C:\bundle\app"


def test_frozen_res_falls_back_to_exe_dir(monkeypatch):
    # PyInstaller one-dir builds expose no _MEIPASS → use the executable's folder.
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.delattr(sys, "_MEIPASS", raising=False)
    monkeypatch.setattr(sys, "executable",
                        r"C:\Program Files\Todoister\Todoister.exe", raising=False)
    assert paths._res_dir() == r"C:\Program Files\Todoister"


# ───────── frozen build: user data lives under %APPDATA%\Todoister ─────────

def test_frozen_data_uses_appdata(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setenv("APPDATA", str(tmp_path))
    result = paths._data_dir()
    assert result == os.path.join(str(tmp_path), "Todoister")
    assert os.path.isdir(result)  # the folder is created


def test_frozen_data_falls_back_to_home(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.delenv("APPDATA", raising=False)
    monkeypatch.setattr(os.path, "expanduser", lambda _p: str(tmp_path))
    result = paths._data_dir()
    assert result == os.path.join(str(tmp_path), "Todoister")
    assert os.path.isdir(result)

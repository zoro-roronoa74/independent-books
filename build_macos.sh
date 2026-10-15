#!/bin/bash
set -e

echo "=========================================================="
echo " Independent Books - macOS Native (.app & .dmg) Builder   "
echo "=========================================================="

# 1. Check Python
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] Python 3 is required. Please install Python 3 or run: brew install python"
    exit 1
fi

echo "[1/5] Checking Apple Developer Tools..."
if ! xcode-select -p &> /dev/null; then
    echo "Installing Xcode command line tools (Clang)..."
    xcode-select --install
fi

echo "[2/5] Installing build requirements..."
python3 -m pip install --quiet --upgrade pip
python3 -m pip install --quiet nuitka openpyxl pytest

echo "[3/5] Running core accounting verification tests..."
python3 -m pytest tests/ -k "not browser"

echo "[4/5] Compiling native C/Mach-O binary with Nuitka & Apple Clang..."
rm -rf dist_mac
python3 -m nuitka \
    --standalone \
    --macos-create-app-bundle \
    --macos-app-name="Independent Books" \
    --macos-app-mode=gui \
    --output-dir=dist_mac \
    --output-filename=IndependentBooks \
    app_server.py

# Copy frontend assets into the .app bundle Resources
APP_RESOURCES="dist_mac/Independent Books.app/Contents/Resources"
mkdir -p "$APP_RESOURCES"
cp index.html fidelity.css workflows.js voucher_logic.js lookup_context.js print_view.js date_picker.js "$APP_RESOURCES/"

# Ensure data directory exists inside Application Support or bundle
mkdir -p "$APP_RESOURCES/data"

echo "[5/5] Generating distributable macOS Disk Image (IndependentBooks.dmg)..."
rm -f IndependentBooks.dmg
hdiutil create \
    -volname "Independent Books" \
    -srcfolder "dist_mac/Independent Books.app" \
    -ov -format UDZO \
    IndependentBooks.dmg

echo "=========================================================="
echo " [SUCCESS] Created IndependentBooks.dmg"
echo " You can now double-click IndependentBooks.dmg to install!"
echo "=========================================================="

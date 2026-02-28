#!/bin/bash

# Setup script for cstrike
# Usage: bash setup.sh

echo "[*] Setting up cstrike..."

# Create virtual environment
if [ ! -d "venv" ]; then
    echo "[*] Creating virtual environment..."
    python3 -m venv venv
fi

# Activate and install dependencies
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

echo "[✓] Setup complete. Activate with: source venv/bin/activate"

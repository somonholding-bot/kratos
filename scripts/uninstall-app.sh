#!/bin/bash
# Quita la app Kratos (no toca el servicio ni los datos).
osascript -e 'tell application "Kratos" to quit' 2>/dev/null || true
launchctl bootout "gui/$(id -u)/com.jarvis.app" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/com.jarvis.app.plist" "$HOME/Desktop/Kratos"
rm -rf "$HOME/Applications/Kratos.app" "$HOME/Desktop/Kratos.app"
echo "App Kratos eliminada"

#!/bin/bash
# Detiene y elimina los servicios de Jarvis. No borra datos ni la base de datos.
for l in server worker backup; do
  launchctl bootout "gui/$(id -u)/com.jarvis.$l" 2>/dev/null && echo "detenido com.jarvis.$l"
  rm -f "$HOME/Library/LaunchAgents/com.jarvis.$l.plist"
done

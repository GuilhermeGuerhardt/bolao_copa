@echo off
echo Iniciando o Bolao dos Imparaveis...
start /b node server.js
timeout /t 2 /nobreak > nul
start http://localhost:3001

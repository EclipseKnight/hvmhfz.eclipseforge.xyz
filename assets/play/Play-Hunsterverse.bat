@echo off
rem Hunsterverse start file for Android (Winlator) and other Windows emulators.
rem It logs in with the command-line mode of the Mezeporta launcher, which
rem needs no launcher window, then starts the game.
rem Put it in the game folder MHFZ, or in the folder that holds MHFZ.
rem Guide: https://frontier.hunsterverse.net/play.html#android
rem Nothing is saved: it asks for your username and password every time.
setlocal
cd /d "%~dp0"
if not exist "Mezeporta.exe" if exist "MHFZ\Mezeporta.exe" cd /d "%~dp0MHFZ"
if not exist "Mezeporta.exe" (
  echo Mezeporta.exe was not found. Put this file in the MHFZ game folder.
  pause
  exit /b 1
)
rem HD graphics. For the lighter SD graphics, change the next line to: set GFX=
set GFX=-HD
set HV_USER=
set HV_PASS=
set HV_SLOT=1
set /p HV_USER=Username (case-sensitive): 
set /p HV_PASS=Password: 
set /p HV_SLOT=Character number, Enter for the first one: 
set /a HV_INDEX=HV_SLOT-1
cls
echo Logging in to Hunsterverse as %HV_USER% ...
Mezeporta.exe -v ZZ -s 129.213.54.221 -t -p1 53312 -p2 53310 -u "%HV_USER%" -pw "%HV_PASS%" -c %HV_INDEX% -fs none %GFX%
set HV_PASS=
echo.
echo The game has closed. If it did not start, read the lines above.
pause

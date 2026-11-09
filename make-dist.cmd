@echo off
chcp 65001 >nul
rem Публичная копия сайта: dist. Админка туда не попадает.
cd /d "%~dp0"
echo Собираю публичную папку dist...
if exist dist rmdir /s /q dist
mkdir dist\seed
for %%F in (index.html news.html matches.html rankings.html events.html event.html bracket.html article.html team.html player.html players.html bench.html) do copy /y %%F dist\ >nul
xcopy /y /q /s /i assets dist\assets >nul
copy /y seed\data.js dist\seed\ >nul
if exist seed\data.standoff.js copy /y seed\data.standoff.js dist\seed\ >nul
if exist dist\assets\js\admin.js del dist\assets\js\admin.js
if exist dist\seed\data.js (echo Снимок данных: seed\data.js на месте) else (echo ВНИМАНИЕ: dist\seed\data.js не найден)
rem Точная копия dist для GitHub Pages: docs
if exist docs rmdir /s /q docs
mkdir docs
xcopy /y /q /s /e dist docs\ >nul
echo. > docs\.nojekyll
echo Готово. В dist и docs нет админки — это то, что видят все.
pause

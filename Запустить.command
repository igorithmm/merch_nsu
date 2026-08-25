#!/bin/bash
# Запуск приложения «Мерч НГУ» на macOS — двойной клик по этому файлу.
cd "$(dirname "$0")" || exit 1

if command -v python3 >/dev/null 2>&1; then
  nohup python3 run.py >/dev/null 2>&1 &
  echo "Мерч НГУ запускается — сейчас откроется браузер."
  echo "Это окно можно закрыть."
  exit 0
fi

osascript -e 'display dialog "Для работы нужен Python — он ещё не установлен.

Сейчас откроется страница загрузки. Установите Python и снова запустите этот ярлык." with title "Мерч НГУ" buttons {"OK"} default button 1 with icon caution' >/dev/null 2>&1
open "https://www.python.org/downloads/"
exit 1

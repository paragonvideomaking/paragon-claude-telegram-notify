# Telegram-уведомления для Claude Code

**[English below](#english)**

Мод для Claude Code. Пишет тебе в Telegram, когда Claude закончил работу и ждёт тебя.
Дал большую задачу, набрал `/notify` и пошёл пить кофе: бот сообщит, какая была задача,
сколько она заняла и чем закончилась.

Этот мод написал Claude Code прямо в [ролике канала Paragon](https://youtu.be/_xPJswwsVnM), по одному промпту. Защиту от чужих чатов,
лимит ожидания и остальные детали Claude продумал сам.

Неофициальный мод: не связан с Anthropic и Telegram. Моды Claude Code — новая возможность, их API ещё
может меняться между версиями. Если после обновления Claude Code что-то сломалось, загляни сюда за новой версией.

```text
✅ Готово, жду тебя
📁 coffee-landing
📝 Собери в этой папке страницу меню для кофейни: menu.html с…
⏱ 4 мин 12 с
💬 Готово: собрал menu.html с восемью позициями и ценами.
```

## Что нужно

- Claude Code с поддержкой модов: в приложении Claude (вкладка Code) или в терминале.
  Проверено на версии 2.1.288.
- Telegram.

## Установка

**Способ 1. Попроси Claude** (как в ролике):

```text
Установи мод: https://github.com/paragonvideomaking/paragon-claude-telegram-notify
```

**Способ 2. Командами в терминале:**

```bash
claude plugin marketplace add paragonvideomaking/paragon-claude-telegram-notify
claude plugin install telegram-notify@paragon-mods
```

После установки набери в Claude `/reload-plugins` или начни новую сессию.

## Настройка (2 минуты)

1. В Telegram открой [@BotFather](https://t.me/BotFather), отправь `/newbot`, придумай имя
   и username (должен заканчиваться на `bot`). BotFather пришлёт токен вида `123456789:AAH…`.
   Скопируй его. Бот нужен **новый**, только для уведомлений: мод забирает все входящие сообщения бота,
   и если бот уже работает в другом сервисе, тот их недосчитается.
2. В Claude набери `/notify setup`. Откроется панель «Telegram-уведомления».
   Вставь токен в поле и нажми Enter. Мод проверит токен.
3. Нажми ссылку на бота в панели, в Telegram нажми **Start**. В панели появится «✅ Подключено»,
   бот пришлёт приветствие.
4. `/notify test`: проверочное сообщение.

Если ссылка не открывается, найди своего бота в Telegram и отправь ему команду `/start <код>`
с кодом из панели. Start нужно нажать в течение 10 минут.

## Команды

| Команда | Что делает |
|---|---|
| `/notify` | Одно уведомление: когда Claude закончит и будет ждать тебя. Потом выключается само |
| `/notify always` | Уведомлять после каждой задачи. Сохраняется в новых сессиях и после `/clear` |
| `/notify off` | Выключить уведомления |
| `/notify test` | Пробное сообщение |
| `/notify setup` | Панель настройки: подключить бота, сменить бота или отключиться |

- `/notify` можно набрать, даже пока Claude работает.
- Пока уведомления включены, внизу в строке состояния горит «🔔 Telegram».
- Если ты прервал задачу (Esc), сообщения не будет: ты и так у экрана.
- Если Claude запустил фоновых агентов, мод ждёт, пока закончат и они.
- Если работа остановилась из-за ошибки, придёт «⚠️ Остановился из-за ошибки, жду тебя».

## Безопасность и приватность

- **Токен не попадает в чат**, если вставлять его в поле панели мода. Это не сообщение:
  модель его не видит, в историю диалога он не попадает, в тексты ошибок тоже.
  Не вставляй токен в обычное поле сообщения Claude: тогда он уйдёт в историю. Если так случилось, отзови токен.
- **Поле не скрывает символы.** Не вставляй токен на стриме или записи экрана. Если токен попал в кадр, отзови его.
- **Где хранится.** Токен и chat_id лежат только на твоём компьютере, в хранилище мода:
  файл `plugins/store/telegram-notify_…json` в папке настроек Claude Code (обычно `~/.claude`).
  Файл не зашифрован, как и у большинства CLI-инструментов.
- **Куда ходит мод.** Только на `api.telegram.org`: адрес зашит в коде, в начале
  [`hooks/register.tsx`](hooks/register.tsx). Отчёт `claude plugin validate` показывает, что мод
  не читает твои файлы, не запускает программы и не вызывает модель.
- **Чужие не подключатся.** В ссылке Start есть случайный одноразовый код. Мод подключает только
  чат, который прислал именно его. Если кто-то ещё напишет твоему боту, мод это проигнорирует.
  Код действует 10 минут, пока он на экране, никому его не показывай.
- **Что уходит в Telegram:** имя папки проекта, первые слова задачи, время работы и первая
  строка ответа Claude. Если проект секретный, учитывай это. Чаты с ботами в Telegram не защищены
  сквозным шифрованием, а текст может всплывать на заблокированном экране телефона. Если запускаешь
  Claude прямо в домашней папке, имя папки совпадает с именем пользователя компьютера.
- **Если токен утёк:** @BotFather → `/mybots` → твой бот → API Token → Revoke current token.
  Потом заново `/notify setup` с новым токеном.
- **Моды Claude Code работают без песочницы.** Другие установленные моды теоретически видят то же,
  что и этот. Ставь только моды, которым доверяешь, и смотри их код. Весь код этого мода лежит
  в папке [`hooks/`](hooks), около 600 строк.

## Удаление

1. `/notify setup` → «Отключить»: мод сотрёт токен и chat_id. Кнопка видна, когда бот подключён.
2. `claude plugin uninstall telegram-notify@paragon-mods`.
3. Если удалил мод раньше, чем нажал «Отключить», удали файл `plugins/store/telegram-notify_…json`
   в папке настроек Claude Code и отзови токен в @BotFather.
4. Если бот больше не нужен: @BotFather → `/mybots` → бот → Delete Bot.

## Частые вопросы

- **«У этого бота настроен webhook».** Бот уже подключён к другому сервису. Создай для уведомлений
  отдельного бота.
- **«Не дождался нажатия Start за 10 минут».** Вставь токен ещё раз и нажми Start.
- **Настройка в мобильном приложении Claude.** Не поддерживается. Настрой в терминале или в приложении
  на компьютере.

## Для разработчиков

```bash
claude plugin validate .
claude plugin test .
```

<details>
<summary>Промпт, которым Claude написал этот мод</summary>

```text
Напиши мод для Claude Code — уведомления в Telegram.
— Команда /notify: когда закончишь работу и будешь ждать меня, пришли сообщение через Telegram-бота: какая была задача (первые слова промпта), сколько заняла и чем закончилась.
— После одного уведомления /notify выключается сам. /notify always — уведомлять всегда, /notify off — выключить, /notify test — пробное сообщение.
— Пока уведомление включено, показывай «🔔 Telegram» в строке состояния внизу.
— Настройка — прямо здесь, в приложении, без терминала: /notify setup открывает панель мода с полем «Токен бота». Я вставляю токен — мод сам его проверяет, показывает ссылку на бота и ждёт, когда я нажму Start; chat_id определяет сам и пишет в панели «✅ Подключено».
— Токен не должен попадать в чат и в код: храни его в хранилище мода.
Проверь мод тестами и скажи, что мне сделать, чтобы попробовать.
```

</details>

## Лицензия

[MIT](LICENSE)

---

<a id="english"></a>

# Telegram notifications for Claude Code

A Claude Code mod that messages you on Telegram when Claude finishes its work and waits for you.
Give it a big task, type `/notify`, go grab a coffee: the bot tells you what the task was,
how long it took and how it ended.

Claude Code wrote this mod live in a [Paragon channel video](https://youtu.be/_xPJswwsVnM), from a single prompt. Protection against
strangers' chats, the wait limit and the other details Claude worked out on its own.
The mod's interface and messages are in Russian.

Unofficial mod, not affiliated with Anthropic or Telegram. Claude Code mods are a new feature and their
API may still change between versions. If something breaks after a Claude Code update, check here for a new version.

## Requirements

- Claude Code with mods support: in the Claude desktop app (Code tab) or in the terminal.
  Tested on version 2.1.288.
- Telegram.

## Install

**Option 1. Ask Claude** (as in the video):

```text
Install this mod: https://github.com/paragonvideomaking/paragon-claude-telegram-notify
```

**Option 2. From the terminal:**

```bash
claude plugin marketplace add paragonvideomaking/paragon-claude-telegram-notify
claude plugin install telegram-notify@paragon-mods
```

Then type `/reload-plugins` in Claude or start a new session.

## Setup (2 minutes)

1. In Telegram, open [@BotFather](https://t.me/BotFather), send `/newbot`, pick a name and a username
   ending in `bot`. BotFather replies with a token like `123456789:AAH…`. Copy it. Use a **new** bot
   just for notifications: the mod takes all of the bot's incoming messages, so a bot that already
   works for another service would lose them there.
2. In Claude, type `/notify setup`. The «Telegram-уведомления» panel opens.
   Paste the token into the field and press Enter. The mod checks the token.
3. Click the bot link in the panel and press **Start** in Telegram. The panel shows «✅ Подключено»
   and the bot sends a greeting.
4. `/notify test` sends a test message.

If the link doesn't open, find your bot in Telegram and send it `/start <code>` with the code
from the panel. You have 10 minutes to press Start.

## Commands

| Command | What it does |
|---|---|
| `/notify` | One notification when Claude finishes and waits for you, then turns itself off |
| `/notify always` | Notify after every task. Survives new sessions and `/clear` |
| `/notify off` | Turn notifications off |
| `/notify test` | Send a test message |
| `/notify setup` | Setup panel: connect a bot, switch bots or disconnect |

- You can type `/notify` while Claude is still working.
- While notifications are on, the status line shows «🔔 Telegram».
- If you interrupt a task (Esc), no message is sent: you're already at the screen.
- If Claude started background agents, the mod waits for them to finish too.
- If the work stopped on an error, you get «⚠️ Остановился из-за ошибки, жду тебя».

## Security and privacy

- **The token stays out of the chat** as long as you paste it into the mod's panel field. That is not
  a message: the model doesn't see it, and it stays out of the conversation history and error messages.
  Don't paste the token into Claude's regular message box: then it goes into the history. If that happens, revoke the token.
- **The field doesn't hide characters.** Don't paste the token on a stream or a screen recording.
  If the token was on screen, revoke it.
- **Where it's stored.** The token and chat_id live only on your computer, in the mod's store:
  the file `plugins/store/telegram-notify_…json` in the Claude Code config folder (usually `~/.claude`).
  The file is not encrypted, as with most CLI tools.
- **Network.** The mod talks only to `api.telegram.org`: the address is hard-coded at the top of
  [`hooks/register.tsx`](hooks/register.tsx). The `claude plugin validate` report shows that the mod
  doesn't read your files, run programs or call the model.
- **Strangers can't connect.** The Start link carries a random one-time code. The mod connects only
  the chat that sends that exact code and ignores anyone else who messages your bot.
  The code is valid for 10 minutes; while it's on screen, don't show it to anyone.
- **What goes to Telegram:** the project folder name, the first words of the task, the run time
  and the first line of Claude's answer. Keep that in mind for confidential projects. Telegram bot chats
  are not end-to-end encrypted, and the text may pop up on your phone's lock screen. If you run Claude
  right in your home folder, the folder name is your computer's user name.
- **If the token leaks:** @BotFather → `/mybots` → your bot → API Token → Revoke current token.
  Then run `/notify setup` again with the new token.
- **Claude Code mods are not sandboxed.** Other installed mods could in theory see what this one sees.
  Install only mods you trust and read their code. All of this mod's code is in [`hooks/`](hooks),
  about 600 lines.

## Uninstall

1. `/notify setup` → «Отключить» erases the token and chat_id. The button shows while the bot is connected.
2. `claude plugin uninstall telegram-notify@paragon-mods`.
3. If you uninstalled the mod before pressing «Отключить», delete the file `plugins/store/telegram-notify_…json`
   in the Claude Code config folder and revoke the token in @BotFather.
4. If you no longer need the bot: @BotFather → `/mybots` → your bot → Delete Bot.

## FAQ

- **«У этого бота настроен webhook»** (the bot has a webhook). The bot is already connected to another
  service. Create a separate bot for notifications.
- **«Не дождался нажатия Start за 10 минут»** (Start wasn't pressed within 10 minutes). Paste the token
  again and press Start.
- **Setup in the Claude mobile app.** Not supported. Set it up in the terminal or the desktop app.

## For developers

```bash
claude plugin validate .
claude plugin test .
```

## License

[MIT](LICENSE)

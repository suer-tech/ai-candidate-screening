# Получатели Telegram-уведомлений

## 1. Сохранить токен бота

Создайте бота через официальный [@BotFather](https://t.me/BotFather) командой `/newbot`. Полученный токен сохраните одной строкой, без кавычек и без имени переменной, в файл:

`web/.runtime/credentials/telegram-bot-token`

Токен не отправляйте в чат и не добавляйте в `telegram-recipients.json`.

## 2. Получить `chat_id`

### Личный получатель

1. Получатель открывает созданного бота.
2. Нажимает **Start / Запустить** и отправляет любое сообщение, например `/start`.
3. Из корня проекта выполните PowerShell-команду ниже.

### Группа

1. Добавьте бота в группу.
2. Отправьте в группе команду `/start@имя_бота` или другое сообщение с упоминанием бота.
3. Из корня проекта выполните PowerShell-команду ниже.

```powershell
$botToken = (Get-Content -LiteralPath "web/.runtime/credentials/telegram-bot-token" -Raw).Trim()
$updates = Invoke-RestMethod -Uri "https://api.telegram.org/bot$botToken/getUpdates"
$updates.result | ForEach-Object {
  $chat = if ($_.message.chat) { $_.message.chat } elseif ($_.channel_post.chat) { $_.channel_post.chat } elseif ($_.my_chat_member.chat) { $_.my_chat_member.chat }
  if ($chat) {
    [pscustomobject]@{
      id = $chat.id
      type = $chat.type
      title = $chat.title
      username = $chat.username
      name = ("$($chat.first_name) $($chat.last_name)").Trim()
    }
  }
} | Sort-Object id -Unique | Format-Table -AutoSize
Remove-Variable botToken, updates
```

Команда не печатает токен. Если список пуст, отправьте боту новое сообщение и повторите команду. Бот не может первым начать личный диалог: каждый личный получатель обязан сначала нажать **Start**.

## 3. Заполнить справочник получателей

Откройте `web/.runtime/credentials/telegram-recipients.json` и запишите объект, где слева находится внутреннее понятное имя, а справа — числовой `chat_id` **в строке**:

```json
{
  "hr_primary": "123456789",
  "hr_backup": "987654321",
  "hr_group": "-1001234567890"
}
```

Допустимые внутренние имена: латинские буквы, цифры, точка, `_` и `-`, максимум 64 символа. Значение должно состоять только из цифр и необязательного начального минуса.

## 4. Перезапустить сервис

```powershell
cd web
npm run local:stop
npm run local:start
```

Путь не настраивается отдельной переменной: runtime читает точное allowlisted имя `telegram-recipients.json`. Браузеру соответствие внутренних имён и `chat_id` не передаётся.

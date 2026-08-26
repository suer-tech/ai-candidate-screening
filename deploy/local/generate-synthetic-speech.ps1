param([Parameter(Mandatory = $true)][string]$OutputPath)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$resolvedParent = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($OutputPath))
if (-not (Test-Path -LiteralPath $resolvedParent -PathType Container)) { throw "Каталог для synthetic speech не существует" }
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $speaker.SetOutputToWaveFile([System.IO.Path]::GetFullPath($OutputPath))
  $speaker.SelectVoice("Microsoft Irina Desktop")
  $speaker.Rate = -1
  $speaker.Speak("Расскажите о проекте, которым вы руководили, и о вашем личном результате.")
  $speaker.Rate = 1
  $speaker.Speak("Я поддерживала сервис на Тайп Скрипт два года. Команда сократила время обработки заявок на двадцать процентов.")
  $speaker.Rate = -1
  $speaker.Speak("Как вы проверили результат и какие ограничения учитывали?")
  $speaker.Rate = 1
  $speaker.Speak("Мы сравнили показатели до и после запуска. Ограничением была небольшая тестовая выборка.")
} finally {
  $speaker.Dispose()
}

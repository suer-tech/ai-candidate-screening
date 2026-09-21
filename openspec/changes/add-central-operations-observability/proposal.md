## Why

HR runtime работает на отдельном VPS и сейчас не имеет единого технического контура для истории нагрузки, очередей, ошибок, ресурсов хоста и раннего обнаружения зависаний. Существующий product dashboard показывает состояние кандидатов, но не заменяет Prometheus/Loki/Grafana и не даёт общему Telegram-агенту Pulse безопасно сопоставлять состояние OCR и HR.

## What Changes

- На HR VPS добавляется изолированный observability stack: Prometheus, Alertmanager, Loki, Grafana, Alloy, node-exporter, cAdvisor и blackbox exporter.
- Добавляется отдельный operations service с Prometheus metrics и фиксированными read-only endpoints для агрегированной истории кандидатов, метрик, allowlisted log events и общего состояния.
- Внешний operations endpoint защищается TLS, отдельным bearer credential и nginx IP allowlist; Grafana и хранилища остаются loopback/private-only.
- В Pulse добавляются отдельные HR tools. Каждый ответ и результат явно маркируется `system=hr` либо `system=ocr`; агрегаты двух систем не смешиваются без явного запроса администратора.
- Критические HR alerts доступны Alertmanager и опрашиваются единым Pulse Telegram bot, включая отдельное уведомление о недоступности самого HR monitoring endpoint.
- Operations API не возвращает имена, идентификаторы кандидатов, вакансии, резюме, интервью, транскрипты, prompts, raw log lines, stack traces, URLs или secrets.

## Capabilities

### New Capabilities

- `central-operations-observability`: локальный HR monitoring stack, безопасный remote read contract и интеграция с общим Pulse.

### Modified Capabilities

- `integrations-and-operations`: добавляются эксплуатационные метрики, logs, alerts, retention и внешний read-only boundary.
- `data-and-security`: агрегированная наблюдаемость и Telegram integration получают явную data-minimization и authentication policy.
- `quality-gates`: добавляются contract/security/configuration tests для monitoring и Pulse boundary.

## Impact

- Новые Docker services и volumes на HR VPS; наружу публикуются только существующие 80/443 и loopback Grafana port.
- В `internal-service-tokens.json` появляется `OPS_READ_INTERNAL_TOKEN`; существующий файл дополняется без ротации остальных credentials.
- OCR admin-bot получает URL и тот же read token HR boundary, но Pulse AI получает только результаты фиксированных tools.
- Production-like проверка реальной доставки alerts и доступности обоих VPS остаётся обязательным deployment evidence и не подменяется unit tests.

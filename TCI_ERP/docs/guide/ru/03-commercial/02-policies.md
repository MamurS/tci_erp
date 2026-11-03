---
id: commercial-policies
title: Полисы: реестр, создание, статусы
roles: [commercial_underwriter, sales]
pages: ["/policies", "/policies/new", "/policies/:id", "/policies/:id/edit"]
order: 2
---

## Когда использовать

Создать полис вручную, изменить его условия или статус, посмотреть премию и лимиты.

## Шаги

1. {{ui:nav.policies}} — раздел с видами {{ui:policies.views.overview}}, {{ui:policies.views.registry}}, {{ui:policies.views.contracts}} и {{ui:policies.views.templates}}.

{{shot:commercial-policies}}

2. Новый полис создаётся как черновик. Обычно он появляется сам — при оформлении заявки продажами.
3. Откройте полис: заголовок со статусом, ключевые цифры, вкладки условий, лимитов, премии и деклараций.
4. Смена статуса — только коммерческим андеррайтером: {{ui:policies.statuses.draft}} → {{ui:policies.statuses.active}} → {{ui:policies.statuses.suspended}} / {{ui:policies.statuses.expired}} / {{ui:policies.statuses.cancelled}} / {{ui:policies.statuses.annulled}}.

## Результат

Каждая смена статуса записывается в историю полиса с автором и комментарием.

## Частые ошибки

- **Путать расторжение и аннулирование.** {{term:cancellation|Расторжение}} прекращает полис с даты, прежнее исполнение остаётся; {{term:annulment|аннулирование}} — полис как будто не заключался, премия возвращается.
- **Ждать график премии у старого полиса.** У полиса, созданного до графиков, нажмите «Создать график» на вкладке премии.

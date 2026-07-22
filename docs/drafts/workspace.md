# Workspace — план прокачки

> Черновик 2026-07-22. **План работ**, не спецификация API.  
> Связано: `docs/ARCHITECTURE.md` · `src/lib/agent/workspace-scope.ts` · `src/components/lia/workspace-panel.tsx` · `docs/kb/README.md` · `DESIGN-agent-instrument.md`

---

## Тезис

**Workspace Лии** — явный контекст «где мы работаем»: диск + KB-источники + память об этом месте.  
Сейчас это три слабо связанных слоя (KB / `fsScope` / UI). Пользователь воспринимает их как одно — и получает путаницу (чат ищет по всей базе, агент пишет в sandbox).

Цель прокачки: **один выбранный workspace на эпизод/задачу**, понятный в UI, согласованный между чатом, KB и агентом.

---

## Как сейчас (baseline)

| Слой | Где | Поведение |
|------|-----|-----------|
| KB | `Source` document/folder/codebase | Hybrid search, citations; не «открытый проект» |
| `fsScope` | `resolveAgentFsScope` | explicit → env → match имени KB в goal → Lia self → **sandbox** |
| UI | `workspace-panel.tsx` | Просмотр дерева по задаче агента |

Боли:

1. Scope часто уходит в пустой `agent-workspaces/…` — агент не видит реальные файлы.
2. Чат ищет по **всем** ready-источникам; нет pin «этот тред = этот документ/папка».
3. Нет единого переключателя workspace в UI чата.
4. Память эпизода ≠ память проекта (стек, договорённости теряются между чатами).

---

## Принципы

1. **Явный выбор > эвристика.** Авто-match по имени в goal — fallback, не основной путь.
2. **Sandbox — черновик**, не основной workspace для «разбери мой протокол / почини проект».
3. **KB и FS связаны**, но не смешиваются: folder = docs, codebase = исходники, document = файл.
4. **Не маунтить корень Lia** без явного запроса (уже частично соблюдено).
5. **Характер Лии не в workspace** — workspace = контекст работы, не личность.
6. Без хардкода под конкретные доки/проекты пользователя — только общие механизмы.

---

## Не цели (сейчас)

- Полноценный IDE / multi-root как в VS Code.
- Второй «умный» агент рядом с Лией.
- Автомаунт Lia repo на любую задачу «про проект».
- Замена KB groundedness / hybrid search (это отдельный трек; уже чинили фильтры).

---

## Фазы (пошагово)

### Фаза 0 — Зафиксировать контракт (док + типы)

**Зачем:** одна терминология для UI, API и агента.

**Шаги:**

1. Описать в этом файле и кратко в `docs/ARCHITECTURE.md` три kind:
   - `project` — абсолютный каталог на диске;
   - `kb` — привязка к `Source` (+ опциональный disk path из config);
   - `sandbox` — эфемерный write-tree под `agent-workspaces/`.
2. Ввести тип `WorkspaceBinding` (черновик полей):
   - `episodeId` / `taskId`;
   - `kind`;
   - `fsPath: string | null`;
   - `sourceIds: string[]` (pinned KB);
   - `label` (человекочитаемое имя);
   - `updatedAt`.
3. Решить persistence: SQLite (`Episode` JSON / отдельная таблица) vs только session — **рекомендация: на Episode**, переживает reload.

**Готово когда:** тип и место хранения согласованы; без UI ещё ок.

---

### Фаза 1 — UI: выбрать и видеть workspace

**Зачем:** пользователь контролирует, «где» Лия, до любого умного авто.

**Шаги:**

1. В шапке чата / панели агента: бейдж **Workspace: …** (имя или «не выбран»).
2. Меню:
   - «Привязать папку…» (путь → `project`);
   - «Из базы знаний…» (список ready folder/codebase/document);
   - «Sandbox (черновик)»;
   - «Сбросить».
3. Показывать kind + короткий path / имя source.
4. Передавать `explicitFsScope` / `workspaceId` в agent start и (фаза 2) в chat pipeline.

**Готово когда:** можно вручную привязать папку или KB source и увидеть это в UI; агент с explicit scope не падает в sandbox без причины.

**Зависит от:** Фаза 0.

---

### Фаза 2 — Pin KB на эпизод (чат)

**Зачем:** тред про один протокол/папку не размывается по всей KB.

**Шаги:**

1. При proactive KB / `search_sources`: если у эпизода есть `sourceIds` — **ограничить поиск** ими (с опцией «искать везде» явно).
2. Follow-up в треде наследует pin (уже есть thread signals — усилить pin’ом).
3. В system prompt: одна строка «Активный workspace / источники: …».
4. После загрузки документа — CTA: «Привязать к этому чату?».

**Готово когда:** вопрос по pinned source не тащит чужой README; в логах видно `sourceIds` фильтра.

**Зависит от:** Фаза 0–1.

---

### Фаза 3 — Единый resolve для чата и агента

**Зачем:** один binding → один `fsScope` + те же KB pins.

**Шаги:**

1. Вынести `resolveWorkspace(episodeId, opts)` над `resolveAgentFsScope`.
2. Приоритет:
   1. Явный binding эпизода / запроса;
   2. `LIA_AGENT_DEFAULT_WORKSPACE`;
   3. Match KB по goal (как сейчас) — только если binding пуст;
   4. Lia self — только по явному упоминанию / env;
   5. Sandbox — только для coding-целей **без** project/kb path;
   6. `none`.
3. Агентский runner читает binding эпизода, если task не задал свой scope.
4. Лог: `workspace kind`, path hash, sourceIds — в debug.

**Готово когда:** один и тот же чат+агент на одном episode видят один корень; sandbox не выбирается, если pin = folder на диске.

**Зависит от:** Фаза 1–2.

---

### Фаза 4 — Режимы Read / Explore / Edit

**Зачем:** разные контракты tools и ожиданий.

| Режим | Tools (идея) | FS write | Типичный кейс |
|-------|----------------|----------|----------------|
| **Read** | KB search/get, list_sources | нет | «что такое поле X в доке» |
| **Explore** | + grep, read_file, search_codebase | нет | «где вызывается Y» |
| **Edit** | + write/edit/run | да, в fsScope | «поправь баг» |

**Шаги:**

1. Эвристика режима из goal + ручной переключатель в UI.
2. Whitelist tools от режима (не только от template researcher/coder).
3. Edit без `project`/`explicit` → предупреждение «будет sandbox» + confirm.

**Готово когда:** Read не открывает write-sandbox; Edit без папки требует confirm.

**Зависит от:** Фаза 3.

---

### Фаза 5 — Workspace memory

**Зачем:** не объяснять стек и договорённости каждый новый чат.

**Шаги:**

1. Факты с префиксом `workspace.<id>.*` или отдельная таблица (не путать с `user.name`).
2. При смене/привязке workspace — подмешивать краткий блок в system prompt (лимит символов).
3. Опционально: первое «обзорное» саммари папки/source в фоне (1 LLM call), сохранить как memory.
4. UI: «Что Лия помнит об этом workspace» (read-only + clear).

**Готово когда:** новый эпизод с тем же pin подтягивает 3–10 устойчивых фактов о проекте.

**Зависит от:** Фаза 2–3.

---

### Фаза 6 — UX как у «лёгкого Cursor»

**Зачем:** прозрачность, не IDE.

**Шаги:**

1. Дерево workspace + превью файла (усилить `workspace-panel`).
2. Клик по citation KB → подсветка чанка / путь.
3. После Edit: список изменённых файлов + undo (если ещё не везде).
4. Статус индекса: ready / indexing / error на pinned sources.
5. Пустые состояния: «Нет workspace — привяжи папку или документ».

**Зависит от:** Фаза 1, 4.

---

### Фаза 7 — Instrument (опционально, железо)

**Зачем:** на 12 GB не выгружать умную модель на каждый tool-шаг.

См. `DESIGN-agent-instrument.md`: Лия = план/итог; лёгкая модель = executor **внутри уже выбранного workspace**.

**Не начинать**, пока фазы 1–3 не стабильны (иначе быстрее копаем не туда).

---

## Порядок внедрения (рекомендуемый)

```text
0 контракт → 1 UI выбор → 2 pin KB в чате → 3 единый resolve
    → 4 режимы Read/Explore/Edit → 5 memory → 6 UX polish → 7 instrument
```

Каждая фаза — отдельный PR / проверяемый инкремент. Не смешивать 2+4+7 в одном диффе.

---

## Критерии приёмки (сквозные)

- [ ] Пользователь всегда видит, какой workspace активен (или что его нет).
- [ ] Explicit / pin побеждает sandbox и «поиск по всей KB».
- [ ] Чат и агент на одном эпизоде согласованы по path и sourceIds.
- [ ] Нет спецветок под конкретные имена проектов/документов пользователя.
- [ ] Тесты: resolve priority, pin filter, sandbox only when allowed.
- [ ] На 12 GB: не обязателен instrument; обязателен предсказуемый scope.

---

## Ключевые файлы

| Файл | Роль |
|------|------|
| `src/lib/agent/workspace-scope.ts` | resolve `fsScope` |
| `src/lib/agent/runner.ts` / `runner-helpers.ts` | использование scope, KB list |
| `src/components/lia/workspace-panel.tsx` | UI дерева |
| `src/lib/chat/pipeline-helpers.ts` | proactive KB |
| `src/lib/kb/*` | search, sources, codebase |
| `src/stores/slices/types.ts` | `fsScope` на клиенте |
| `docs/ARCHITECTURE.md` | зафиксировать контракт после фазы 0 |

---

## Открытые решения (зафиксировано 2026-07-22)

1. **Persistence:** EpisodeFact key `lia.workspace` (JSON) — без миграции Prisma; переживает reload. Позже можно перенести в `Episode.workspaceJson`.
2. **Document-only pin:** `fsPath = null`, только `sourceIds` — ок (чат/KB pin без FS).
3. **Max pinned sources:** 5; UI default — 1.
4. **Env default:** в UI как «Домашний (env)» когда задан `LIA_AGENT_DEFAULT_WORKSPACE`.
5. **AgentTask override:** явный `fsScope` в запросе > episode binding > эвристики.

---

## История

| Дата | Что |
|------|-----|
| 2026-07-22 | Первый план: фазы 0–7, принципы, non-goals |
| 2026-07-22 | Реализация 0–3: типы, API, UI badge, pin KB, `resolveWorkspace` |
| 2026-07-22 | Фаза 4: Read/Explore/Edit — whitelist, UI, sandbox confirm |
| 2026-07-22 | Фаза 5: workspace memory (GlobalFact fingerprint, prompt, UI) |
| 2026-07-22 | Фаза 6: citation→chunk, empty states, pin status, file→tree |

// Task Complexity Classifier — determines how hard a user message is.
//
// Used by cognitive-depth.ts to decide how many LLM calls to make.
// On a max-tier model, even simple questions get 1 call (no waste).
// On any tier, complex questions get the full pipeline.

export type TaskComplexity = 'trivial' | 'simple' | 'moderate' | 'complex' | 'research';

/** JS \\b — только ASCII; для кириллицы используем includes по стемам. */
function hasStem(text: string, stems: string[]): boolean {
  const lower = text.toLowerCase();
  return stems.some(stem => lower.includes(stem));
}

function matchesPatterns(text: string, patterns: RegExp[]): boolean {
  const lower = text.toLowerCase();
  return patterns.some(p => p.test(lower));
}

// Trivial — greetings, thanks, acknowledgements, light social
const TRIVIAL_PATTERNS = [
  /^(привет|здравствуй|здравствуйте|хай|hi|hello|приветик)(?![\p{L}\p{N}])/iu,
  /^(пока|до свидания|bye|goodbye|увидимся)(?![\p{L}\p{N}])/iu,
  /^(спасибо|благодарю|thanks|thank you|спс)(?![\p{L}\p{N}])/iu,
  /^(ок|окей|хорошо|ладно|да|нет|угу|ага)(?![\p{L}\p{N}])/iu,
  /^(как дела|как ты|что делаешь|как настроение)(?![\p{L}\p{N}])/iu,
  /^(расскажи|пошути|давай).{0,40}(шутк|анекдот)/iu,
];

/** Companion smalltalk without real work — keep 1-call plans on plus/max. */
const SOCIAL_CHATTER_STEMS = [
  'шутк', 'анекдот', 'пошути', 'поболта', 'поговорим', 'просто сказала',
  'не хочу', 'не надо', 'спасибо', 'ты умница', 'как меня зовут',
  'расскажи о себе', 'расскажи про себя', 'давай о тебе', 'про тебя',
];

// Research — needs information gathering (web search, file analysis)
const RESEARCH_STEMS = [
  'найди информацию', 'поищи', 'загугли', 'что нового', 'актуальн', 'последн',
  'версия', 'release', 'changelog', 'обновлен', 'документаци', 'documentation',
  'статистик', 'исследовани',
];

// Complex — multi-step reasoning, analysis
const COMPLEX_STEMS = [
  'докажи', 'выведи', 'обоснуй', 'проанализируй', 'сравни', 'оцени', 'рассмотри',
  'архитектур', 'проектир', 'стратеги', 'план реализации', 'пошаговый план',
  'почему', 'зачем', 'как устроен', 'как работает', 'в чём разница',
  'рефакторинг', 'оптимизируй', 'найди ошибку', 'debug', 'дебаг',
];

// ============================================================================
// Factual question detector — для принудительного web_search.
// Возвращает true если вопрос требует актуальной информации из интернета:
// новости, версии, даты релизов, API, цены, факты о людях/событиях.
// ============================================================================
const FACTUAL_STEMS = [
  'новост', 'что нового', 'последн', 'актуальн', 'свеж', 'недавн',
  'версия', 'release', 'changelog', 'обновлен', 'релиз', 'вышла', 'вышел',
  'когда выйдет', 'дата выхода', 'когда релиз', 'во сколько',
  'сколько стоит', 'цена', 'стоимость', 'купить', 'заказать',
  'документаци', 'docs', 'documentation', 'спецификаци', 'how to', 'как сделать', 'туториал',
  'сравни', ' vs ', 'лучше', 'хуже', 'отличи', 'разница между',
  'матч', 'счёт', 'результат', 'турнир', 'чемпионат', 'лига',
  'погода', 'температура', 'курс', 'доллар', 'евро', 'рубл',
];

// P-CORE-33 fix: previously used `\b` which is ASCII-only (`\w` = [A-Za-z0-9_]).
// Cyrillic word boundaries weren't reliably matched — "расскажи" at start of
// string sometimes passed, sometimes didn't, depending on the JS engine.
// Now we use Unicode property escapes `(?<![\p{L}\p{N}])` / `(?![\p{L}\p{N}])`
// with the `u` flag, consistent with TRIVIAL_PATTERNS (P2-1 fix).
const FACTUAL_PATTERNS = [
  /(?<![\p{L}\p{N}])(расскажи (про|о|об))(?![\p{L}\p{N}]).*?(?<![\p{L}\p{N}])(GTA|gta|iPhone|айфон|Tesla|тесла|OpenAI|ChatGPT|GPT|Claude|Gemini|Windows|Android|iOS|macOS|Linux|Ubuntu|Python|JavaScript|TypeScript|React|Next|Vue|Node|Docker|Kubernetes)/iu,
  /(?<![\p{L}\p{N}])(что такое|что это|расскажи про|расскажи о|расскажи об)(?![\p{L}\p{N}]).*?(?<![\p{L}\p{N}])(\d{4}|\d+\.\d+|vs|или)/iu,
];

const COMPLEX_MATH_PATTERNS = [
  /(?<![\p{L}\p{N}])(переведи|реши|вычисли|рассчитай)(?![\p{L}\p{N}]).*?(?<![\p{L}\p{N}])(уравнени|задач|формул|интеграл|производн)/iu,
];

export function isFactualQuestion(message: string): boolean {
  const lower = message.toLowerCase();
  if (hasStem(lower, FACTUAL_STEMS)) return true;
  return matchesPatterns(lower, FACTUAL_PATTERNS);
}

/**
 * Сообщение — разговорное (приветствие, smalltalk, «что делаем»), без запроса
 * внешних фактов. Использует уже существующую классификацию сложности, без
 * отдельных regex-исключений под конкретные фразы.
 */
export function isConversationalMessage(message: string, complexity: TaskComplexity): boolean {
  const lower = message.trim().toLowerCase();
  if (complexity === 'trivial') return true;
  if (complexity === 'research') return false;
  if (isFactualQuestion(message)) return false;
  if (hasStem(lower, RESEARCH_STEMS)) return false;

  if (complexity === 'simple') return true;

  // Длинное сообщение с приветствием в начале — всё ещё smalltalk, если нет research/factual
  const firstClause = lower.split(/[.!?]/)[0]?.trim() ?? lower;
  if (TRIVIAL_PATTERNS.some(p => p.test(firstClause))) return true;

  return false;
}

/**
 * Вопрос про локальную базу знаний (документы, папки, codebase в KB).
 * Для таких вопросов не делаем proactive web_search — модель должна использовать search_sources.
 */
const KB_QUESTION_STEMS = [
  'readme', 'база знан', 'knowledge base', 'kb ', ' kb', 'search_sources',
  'загружен', 'документ', 'источник', 'папк',
  'по readme', 'из readme', 'в readme', 'по документу', 'из документа',
  'проект lia', 'lia v2', 'lia-v2', 'стек', 'stack', 'фреймворк', 'архитектур',
  'протокол', 'найди в базе', 'найди в документ', 'найди в readme', 'найди в папк',
];

export function isKbQuestion(message: string): boolean {
  const lower = message.toLowerCase();
  if (KB_QUESTION_STEMS.some(stem => lower.includes(stem))) return true;
  if (/найди\s+информацию\s+(по|в|из)\s+/i.test(message)) return true;
  if (/найди\s+(в|по|из)\s+(базе|документ|readme|папк|kb|источник)/i.test(message)) return true;
  return false;
}

/**
 * Нужен ли proactive web_search (RAG до LLM): только когда вопрос требует
 * информации вне весов модели и памяти эпизода.
 *
 * Не путать с plan.autoWebSearch (подсказка tier: слабым моделям полезен search)
 * и plan.toolsEnabled (tools в streamText — модель может вызвать search сама).
 */
export function needsProactiveWebSearch(message: string, complexity: TaskComplexity): boolean {
  if (isKbQuestion(message)) return false;
  if (isConversationalMessage(message, complexity)) return false;
  if (isFactualQuestion(message)) return true;
  if (complexity === 'research') return true;
  return false;
}

// ============================================================================
// Agent task detector — определяет задачи, которые лучше выполнять в agent mode.
// Возвращает true если задача требует:
//   - Многошаговой работы (создать проект, написать игру, проанализировать код)
//   - Нескольких файлов/артефактов
//   - Изучения API + написания кода + проверки
// Такие задачи в обычном chat mode (даже deep) выполняются плохо —
// модель не может сделать несколько шагов с tools.
// ============================================================================
const AGENT_TASK_PATTERNS = [
  // Создание полноценных проектов/игр/приложений
  // P-CORE-33 fix: Unicode property escapes for Cyrillic word boundaries.
  /(?<![\p{L}\p{N}])(напиши (игру|приложение|сайт|программу|скрипт|бота|сервис))/iu,
  /(?<![\p{L}\p{N}])(создай (игру|приложение|сайт|проект|бота|сервис))/iu,
  /(?<![\p{L}\p{N}])(сделай (игру|приложение|сайт|проект|бота))/iu,
  // Разработка с конкретными технологиями
  /(?<![\p{L}\p{N}])(разработай|спроектируй|реализуй)(?![\p{L}\p{N}]).*?(?<![\p{L}\p{N}])(на |используя|с помощью)/iu,
  // Многофайловые задачи
  /(?<![\p{L}\p{N}])(многофайлов|несколько файлов|структура проекта|разбей на файлы)/iu,
  // Анализ существующего кода/проекта
  /(?<![\p{L}\p{N}])(проанализируй код|изучи проект|разберись в коде|ревью кода)/iu,
  // Глубокое самоисследование Лии (без лимита времени)
  /(?<![\p{L}\p{N}])(изучи себя|исследуй себя|познай себя|самоисследован|самопознан|study yourself|research yourself)/iu,
  /(?<![\p{L}\p{N}])(доскональн\w*).{0,40}(?<![\p{L}\p{N}])себ/iu,
  /(?<![\p{L}\p{N}])(разберись в себе|кто ты изнутри|как ты устроен)/iu,
  // Интеграция API
  /(?<![\p{L}\p{N}])(интегрируй|подключи api|используй api)(?![\p{L}\p{N}])/iu,
  // Рефакторинг больших объёмов
  /(?<![\p{L}\p{N}])(отрефактори|перепиши|модернизируй)(?![\p{L}\p{N}]).*?(?<![\p{L}\p{N}])(проект|весь код|большой)/iu,
];

export function isAgentTask(message: string): boolean {
  const lower = message.toLowerCase();
  return AGENT_TASK_PATTERNS.some(p => p.test(lower));
}

export function classifyTaskComplexity(message: string): TaskComplexity {
  const text = message.trim();
  const lower = text.toLowerCase();

  // Length-based signals
  if (text.length < 20) {
    // Very short — likely trivial
    if (TRIVIAL_PATTERNS.some(p => p.test(text))) return 'trivial';
    // Short KB/tech acronym (СМСВ, EGTS, ADAS) — not smalltalk
    if (/(?<![\p{L}\p{N}])[\p{Lu}]{2,12}(?![\p{L}\p{N}])/u.test(text)) return 'simple';
    if (isKbQuestion(text)) return 'simple';
    // Short but with question mark — simple question
    if (text.includes('?')) return 'simple';
    return 'trivial';
  }

  // Explicit social / ack — never pay deliberate×2 on companion chat.
  // Do not swallow real questions that only start with «привет».
  if (text.length < 160 && hasStem(lower, SOCIAL_CHATTER_STEMS)) {
    return text.includes('?') ? 'simple' : 'trivial';
  }
  if (
    text.length < 80
    && TRIVIAL_PATTERNS.some(p => p.test(text))
    && !text.includes('?')
  ) {
    return 'trivial';
  }

  // Check patterns in order of complexity
  if (hasStem(lower, RESEARCH_STEMS)) return 'research';
  if (hasStem(lower, COMPLEX_STEMS) || matchesPatterns(lower, COMPLEX_MATH_PATTERNS)) return 'complex';

  // Long message without complexity markers — moderate (real multi-part asks)
  if (text.length > 500) return 'moderate';

  // Has question — simple
  if (text.includes('?')) return 'simple';

  // Mid-length statement / request without research markers:
  // default simple (1 call). Reserve moderate for clearly multi-part work.
  if (text.length > 220 || (text.match(/[.!?…]/g) ?? []).length >= 3) {
    return 'moderate';
  }

  return 'simple';
}

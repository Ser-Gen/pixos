# GigaAM Browser Transcriber

Статическое offline-демо: аудио → текст на русском через **GigaAM v3** и **sherpa-onnx WASM**.

## Возможности

- **Редактор субтитров**: waveform с амплитудой, список фраз с правкой текста и таймкодов, говорящие с цветами
- Распознавание **локального файла**, аудио по **HTTP URL** (см. ниже), **записи** или **Live** (фразы добавляются в ту же дорожку)
- **VAD** (Silero), настройки в панели «Настройки» (иконка шестерёнки справа в тулбаре)
- **URL .wasm / .data** — GET `?wasm=…&data=…`, UI «Настройки» или `localStorage`
- Экспорт **SRT** и **HTML** для публикации разметки (waveform + субтитры при воспроизведении)
- Разделение/объединение субтитров, выделение на waveform (Alt+drag), снятие выделения (Escape / «Снять выделение»), сдвиг границ (Shift+край)
- Клик по сегменту на waveform выделяет строку в списке субтитров и прокручивает к ней
- Распознавание в **Web Worker**, кэш модели в **OPFS**

### Интерфейс редактора

- Слева — говорящие; справа — субтитры на всю оставшуюся ширину
- В строке субтитра: таймкод сверху, выбор говорящего под ним, текст справа
- В шапке waveform: слева ▶ и время, справа имя файла
- Панель **Лог** свёрнута по умолчанию; при развороте занимает место у основных панелей, без прокрутки всей страницы
- Правка текста субтитров не сбрасывает фокус с поля ввода

## Запуск

WASM с pthreads требует `crossOriginIsolated` (COOP/COEP). SharedArrayBuffer без этого не работает.

### Вариант A — любой статический сервер (рекомендуется для деплоя)

Service worker (`service-worker.js`) подмешивает COOP/COEP и кэширует артефакты WASM в **OPFS** (Origin Private File System):

- **`.wasm` (~12 MB)** — `sherpa-onnx-wasm-<версия>.wasm`
- **`.data` (~300 MB)** — `sherpa-onnx-wasm-<версия>.data` (поддержка Range-запросов Emscripten)

**Первый визит** — загрузка с сервера; после успешной инициализации модель сохраняется в OPFS. **Следующие визиты** — из OPFS без повторной загрузки ~320 MB.

```bash
python3 -m http.server 8080
```

Откройте http://localhost:8080. **При первом заходе страница перезагрузится один раз** — это нормально, пока SW не возьмёт контроль. Нужны HTTPS или localhost; в приватном режиме SW может быть недоступен.

Service worker также обрабатывает **`/api/audio`** — прокси удалённого аудио с CORS (см. [Аудио по URL](#аудио-по-url)).

### Вариант B — сервер с заголовками (без SW и перезагрузки)

```bash
python3 serve.py 8080
```

Тот же URL. COOP/COEP на сервере, но **без OPFS-кэша** — `.wasm` / `.data` качаются при каждом обновлении страницы.

Дополнительно `serve.py` отдаёт прокси **`GET /api/audio?url=<http(s)://…>`** для загрузки удалённого аудио с заголовком `Access-Control-Allow-Origin: *` (см. [Аудио по URL](#аудио-по-url)).

Первый запуск с SW: однократная загрузка ~320 MB модели, нужен Chrome и ≥4 GB RAM. Дальше — из кэша браузера.

## Аудио по URL

Аудио для распознавания можно указать без ручного выбора файла.

### Query в адресе страницы (автозагрузка)

При открытии приложения URL из query подставляется в поле, файл скачивается, waveform готов — остаётся дождаться модели WASM и нажать **Распознать**.

```
http://localhost:8080/?audio=https://example.com/recording.wav
```

С WASM на CDN:

```
http://localhost:8080/?wasm=…&data=…&audio=https%3A%2F%2Fcdn.example.com%2Frecording.wav
```

Также поддерживаются ключи `url` и `audioUrl`. Значение с спецсимволами кодируйте (`encodeURIComponent`). Старые ссылки `#audio=…` по-прежнему работают (fallback).

### Поле в тулбаре

Поле **URL аудио** + **Загрузить** (или Enter). Последний URL сохраняется в `localStorage`; при успешной загрузке в адрес добавляется `?audio=…` для удобной передачи ссылки.

### Загрузка и CORS

1. Сначала выполняется прямой `fetch` к указанному URL — на сервере аудио должны быть CORS-заголовки (`Access-Control-Allow-Origin`).
2. При ошибке CORS используется same-origin прокси **`/api/audio?url=…`**:
   - в **`serve.py`** (вариант B);
   - в **`service-worker.js`** (вариант A, `python3 -m http.server`).

Логика в `audio-url.js`; привязка к UI — в `editor-controller.js`.

## Структура

```
├── app.js                    # точка входа
├── editor-controller.js      # оркестрация UI + ASR
├── transcript-model.js       # сегменты, говорящие, правки
├── waveform-view.js          # дорожка + regions
├── transcript-panel.js       # список субтитров
├── speakers-panel.js         # говорящие
├── wasm-settings.js          # localStorage URL WASM
├── audio-url.js              # URL/query аудио, fetch, прокси /api/audio
├── share-export.js           # экспорт разметки в один HTML-файл
├── editor.css
├── gigaam-transcriber.js     # публичный ES-модуль
├── srt.js                    # SRT + таймкоды
├── recognizer-worker.js      # WASM-воркер (VAD + ASR)
├── index.html
├── coi-serviceworker.js      # legacy (заменён на service-worker*.js)
├── service-worker.js           # COOP/COEP + OPFS-кэш .wasm/.data
├── service-worker-register.js
├── wasm-assets-config.js       # URL .wasm / .data, WASM_CACHE_VERSION
├── serve.py                  # HTTP-сервер с COOP/COEP + /api/audio (альтернатива SW)
├── sherpa-onnx-asr.js
├── sherpa-onnx-wasm.js
├── sherpa-onnx-wasm.wasm / .data   # можно не деплоить, если заданы CDN URL
└── src/sherpa-onnx-master/   # исходники и сборка WASM
```

## WASM-артефакты на отдельном хосте (CDN)

**Да, это поддерживается.** Emscripten качает `.wasm` и `.data` по HTTP; пути задаются в `Module.locateFile` (см. `recognizer-worker.js`).

Укажите URL одним из способов:

1. **GET-параметры** (удобно для ссылки «поделиться») — при открытии сохраняются в `localStorage` и подхватываются worker'ом:

```
https://your-host.example/?wasm=https%3A%2F%2Fcdn.example.com%2Fsherpa-onnx-wasm.wasm&data=https%3A%2F%2Fcdn.example.com%2Fsherpa-onnx-wasm.data
```

Короткие имена: `wasm` и `data`. Также: `wasm_url`, `wasmUrl`, `wasmBinaryUrl`, `wasm_data`, `wasmDataUrl`, `dataUrl`. Можно указать только один параметр — второй возьмётся из сохранённых настроек.

С аудио в query:

```
https://your-host.example/?wasm=…&data=…&audio=https%3A%2F%2Fcdn.example.com%2Frecording.wav
```

2. **Настройки → Модель WASM** в UI (сохраняется в `localStorage`, после сохранения — перезагрузка).

3. **`wasm-assets-config.js`** по умолчанию:

```javascript
var WASM_BINARY_URL = 'https://cdn.example.com/path/sherpa-onnx-wasm.wasm';
var WASM_DATA_URL = 'https://cdn.example.com/path/sherpa-onnx-wasm.data';
```

Пустая строка — локальные `./sherpa-onnx-wasm.wasm` и `./sherpa-onnx-wasm.data`.

На CDN/хранилище для каждого файла нужны заголовки:

| Заголовок | Зачем |
|-----------|--------|
| `Access-Control-Allow-Origin: *` (или ваш origin) | браузер разрешит fetch из worker |
| `Cross-Origin-Resource-Policy: cross-origin` | если COEP `require-corp` (`serve.py`) |

При `coi-serviceworker` (режим `credentialless`) часто достаточно CORS; при ошибке загрузки проверьте Network в DevTools.

На origin приложения остаются **`sherpa-onnx-wasm.js`**, worker и UI; на CDN — `.wasm` и `.data` (или только один из них).

## Кэш `.wasm` / `.data` (OPFS)

Работает при **варианте A** (service worker). Оба файла хранятся в OPFS с именами `sherpa-onnx-wasm-<версия>.wasm` / `.data`. Смените `WASM_CACHE_VERSION` в `wasm-assets-config.js`, чтобы сбросить кэш.

В **`wasm-assets-config.js`**:

```javascript
var WASM_CACHE_VERSION = '3'; // увеличьте после обновления модели
```

Старые файлы с другой версией **удаляются** при установке/активации SW (в OPFS остаётся только пара `sherpa-onnx-wasm-<версия>.{wasm,data}` ≈ 320 MB, а не N×320 MB). На время первой загрузки после обновления возможны два набора файлов, пока SW не активируется и не удалит предыдущую версию.

CDN-URL кэшируются так же (нужен CORS). Без service worker (`serve.py`) кэш не используется.

## Экспорт HTML (публикация разметки)

Кнопка **HTML** в тулбаре скачивает один самодостаточный файл (например `запись.html`) с:

- вшитыми сегментами, говорящими и пиками waveform;
- полем URL аудио и выбором файла с компьютера;
- воспроизведением, дорожкой с цветными регионами и субтитрами текущего сегмента.

**Как выложить:** загрузите на хостинг HTML и аудио **в одну папку**, в поле URL укажите имя файла (`recording.wav`) или полный `https://…`. При отсутствии CORS на CDN сработает прокси `/api/audio` (если страница открыта через `serve.py` или SW).

Генерация: `share-export.js` (`buildSharePayload`, `downloadShareHtml`).

## Модуль `gigaam-transcriber.js`

Подключение на любой странице. Если сервер не отдаёт COOP/COEP — добавьте регистрацию SW **до** модуля:

```html
<script src="./wasm-assets-config.js"></script>
<script src="./service-worker-register.js"></script>
<script type="module">
  import GigaamTranscriber from './gigaam-transcriber.js';

  const transcriber = new GigaamTranscriber();

  transcriber.addEventListener('status', (e) => {
    console.log(e.detail.text); // прогресс загрузки модели
  });

  transcriber.addEventListener('ready', () => {
    console.log('готово');
  });

  transcriber.addEventListener('transcribe-end', (e) => {
    console.log(e.detail.text);
    console.log(e.detail.segments); // [{ start, end, duration, text }, …]
    console.log(e.detail.srt);      // готовый .srt
  });

  const blob = ...; // File или Blob с аудио
  const result = await transcriber.transcribe(blob, { source: 'файл: test.wav' });
  // { text, segments, srt, source, startedAt, finishedAt, durationMs }
</script>
```

```javascript
import { segmentsToSrt } from './srt.js';
// segmentsToSrt([{ start: 1.2, end: 4.8, text: '…' }])
```

### API

| | |
|---|---|
| `new GigaamTranscriber(options?)` | `sampleRate` (default 16000), `workerUrl` |
| `transcriber.ready` | Promise, резолвится после загрузки модели |
| `transcriber.isReady` | boolean |
| `transcriber.isBusy` | boolean |
| `transcriber.transcribe(blob, { source })` | Promise с результатом |
| `transcriber.startLive({ source })` | Live: VAD + ASR по фразам |
| `transcriber.feedLiveAudio(samples)` | Float32Array 16 kHz mono |
| `transcriber.stopLive()` | Promise с финальным результатом |
| `transcriber.isLive` | boolean |
| `transcriber.terminate()` | остановить воркер |

### События

`status` · `ready` · `error` · `transcribe-start` · `transcribe-segment` · `transcribe-end` · `transcribe-error`

### Дополнительно

```javascript
import { decodeAudioBlob } from './gigaam-transcriber.js';
const samples = await decodeAudioBlob(blob); // декодирование в 16 kHz mono без распознавания
```

WASM-артефакты и `recognizer-worker.js` должны лежать рядом с модулем (пути резолвятся через `import.meta.url`).

## Сборка WASM (если нужна пересборка)

Модель GigaAM кладётся в `wasm/vad-asr/assets/` с переименованием под sherpa-onnx. Подробный чеклист — в [todo.md](todo.md).

```bash
cd src/sherpa-onnx-master
./build-wasm-simd-vad-asr.sh
```

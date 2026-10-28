require("dotenv").config();
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const crypto = require("crypto");
const { Pool } = require("pg");
const path = require("path");

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const APP_URL = process.env.APP_URL;
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes("render.com")
        ? { rejectUnauthorized: false }
        : undefined
    })
  : null;

const memorySaves = new Map();

async function initDb() {
  if (!pool) {
    console.warn("DATABASE_URL is missing. Save data is temporary in-memory only.");
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_saves (
      telegram_id TEXT PRIMARY KEY,
      save_data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log("PostgreSQL save table ready.");
}

function validateTelegramInitData(initData) {
  if (!BOT_TOKEN || !initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const calculatedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  const a = Buffer.from(calculatedHash, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;

  try {
    const user = JSON.parse(params.get("user") || "{}");
    return user.id ? String(user.id) : null;
  } catch {
    return null;
  }
}

function makeInitialSave(difficulty = "medium") {
  return {
    version: 1,
    chapter: 1,
    scene: "intro",
    difficulty,
    stats: { health: 100, sanity: 100, battery: 82, suspicion: 8, distortion: 0, evaTrust: 0 },
    inventory: ["Фонарик", "Диктофон"],
    clues: [],
    flags: {},
    history: [],
    updatedAt: new Date().toISOString()
  };
}

const scenes = {
  intro: {
    location: "ОПЕРАТОРСКАЯ // 00:41",
    title: "Последняя смена",
    text: "Вентиляция гудит за стеной. На трёх мониторах — пустые коридоры. По документам Сектор-9 закрыт семнадцать лет назад, но на столе лежит свежий пропуск с твоим именем. Радиоприёмник щёлкает сам по себе.",
    choices: [
      { id: "radio", label: "Проверить радиоприёмник", result: "Ты поворачиваешь регулятор. Сквозь шипение пробивается спокойный голос: «Оператор, не выходи в коридор». Голос звучит точно как твой.", effects: { sanity: -4, suspicion: 4 }, next: "voice" },
      { id: "monitor", label: "Осмотреть камеры наблюдения", result: "На камере 04 пустой коридор. На камере 05 — та же сцена, но в конце коридора стоит высокая фигура. Когда ты переключаешься обратно, камера 04 уже показывает её тоже.", effects: { battery: -3, suspicion: 6 }, next: "camera" },
      { id: "badge", label: "Изучить пропуск на столе", result: "На пропуске твоё имя и фотография, сделанная под холодным больничным светом. Внизу напечатано: ДОПУСК ОПЕРАТОР-0. Дата выдачи — семнадцать лет назад.", effects: { distortion: 3 }, addClue: "Пропуск Оператора-0", next: "badge" }
    ]
  },
  voice: {
    location: "ОПЕРАТОРСКАЯ // СИГНАЛ 01",
    title: "Собственный голос",
    text: "Голос повторяет: «03:17. Не верь женщине в медицинском секторе». Затем звучит три коротких удара — будто кто-то стучит с другой стороны стены.",
    choices: [
      { id: "record", label: "Записать сообщение на диктофон", result: "Запись сохраняется, но на воспроизведении после твоего голоса слышно чужое дыхание. В архиве появляется новая улика.", effects: { battery: -2 }, addClue: "Запись собственного голоса", next: "hall" },
      { id: "reply", label: "Ответить голосу по радио", result: "«Ты опять выбрал этот вариант», — отвечает голос. Радиоприёмник гаснет. На панели появляется сообщение: КАНАЛ ЗАКРЫТ.", effects: { sanity: -8, distortion: 5, suspicion: 5 }, next: "hall" },
      { id: "disconnect", label: "Выдернуть кабель питания", result: "Искры освещают комнату. На секунду все мониторы показывают тебя со спины — хотя ты стоишь лицом к ним.", effects: { battery: 2, sanity: -3 }, next: "hall" }
    ]
  },
  camera: {
    location: "ОПЕРАТОРСКАЯ // КАМЕРЫ",
    title: "Камера 05",
    text: "Фигура исчезает, но изображение продолжает показывать пустой коридор с открытой дверью. На полу лежит что-то похожее на кассету. В журнале камеры последняя запись датирована 17 годами ранее.",
    choices: [
      { id: "zoom", label: "Увеличить изображение", result: "Пиксели распадаются на полосы. На стекле двери проступает надпись изнутри: «НЕ СМОТРИ НАЗАД».", effects: { sanity: -5, battery: -4 }, addClue: "Надпись на камере", next: "hall" },
      { id: "switch", label: "Переключить все камеры по очереди", result: "На каждой камере фигура стоит чуть ближе. На последней она смотрит прямо в объектив.", effects: { suspicion: 10, sanity: -4 }, next: "hall" },
      { id: "log", label: "Открыть журнал записей", result: "Журнал показывает, что камера записала твоё прибытие вчера. Ты уверен, что пришёл сюда меньше часа назад.", effects: { distortion: 6 }, addClue: "Журнал камеры", next: "hall" }
    ]
  },
  badge: {
    location: "ОПЕРАТОРСКАЯ // ДОКУМЕНТЫ",
    title: "Оператор-0",
    text: "Пропуск слегка тёплый, будто его только что держали в руке. На обороте ручкой написано: «Если найдёшь это, значит, архив снова стёрт». За дверью слышится скрежет металла.",
    choices: [
      { id: "pocket", label: "Забрать пропуск", result: "Ты прячешь пропуск. На панели доступа загорается новый сектор: АРХИВ.", effects: {}, addItem: "Пропуск Оператора-0", next: "hall" },
      { id: "photo", label: "Сравнить фотографию со своим отражением", result: "Лицо на фотографии твоё, но глаза закрыты. В отражении ты моргаешь — фотография остаётся с открытыми глазами.", effects: { sanity: -6, distortion: 4 }, next: "hall" },
      { id: "destroy", label: "Разорвать пропуск", result: "Пластик рвётся слишком легко. Под ним нет чипа — только тонкий слой фотобумаги с изображением твоего лица, снятого со спины.", effects: { distortion: 7, suspicion: 3 }, next: "hall" }
    ]
  },
  hall: {
    location: "СЕКТОР A // КОРИДОР",
    title: "За дверью",
    text: "Замок щёлкает. Коридор освещён одной красной лампой. Впереди — развилка к жилому блоку, медицинскому сектору и архиву. В динамике раздаётся тихий вдох, словно кто-то стоит прямо за твоим ухом.",
    choices: [
      { id: "residential", label: "Направиться в жилой блок", result: "Ты выбираешь путь к комнатам персонала. На стене свежей краской написано число 38.", effects: { battery: -4 }, next: "residential" },
      { id: "medical", label: "Проверить медицинский сектор", result: "За стеклом виден силуэт в белом халате. Он исчезает прежде, чем ты успеваешь открыть дверь.", effects: { suspicion: 5, sanity: -2 }, next: "medical" },
      { id: "archive", label: "Попробовать открыть архив", result: "Считыватель мигает красным. Для доступа нужен пропуск старшего персонала. За дверью кто-то трижды стучит в ответ.", effects: { suspicion: 3 }, next: "archive" }
    ]
  },
  residential: {
    location: "ГЛАВА 2 // ЖИЛОЙ БЛОК",
    title: "Комната 38",
    text: "На двери комнаты выцарапано «38». Внутри аккуратно застелена кровать, на столе стоит чашка с ещё тёплым чаем. На стене висит фотография команды Сектора-9. Одно лицо вырезано.",
    choices: [
      { id: "photo", label: "Изучить фотографию", result: "На обратной стороне написано: «Мы не пропали. Нас повторили».", effects: { distortion: 4 }, addClue: "Фотография команды", next: "residential2" },
      { id: "cup", label: "Проверить чашку", result: "Чай пахнет железом. На дне чашки лежит крошечный ключ с номером 09.", effects: { sanity: -2 }, addItem: "Ключ 09", next: "residential2" },
      { id: "closet", label: "Открыть шкаф", result: "Внутри висит твоя рабочая куртка. В кармане — записка: «Не позволяй Еве включить источник».", effects: { suspicion: 4 }, addClue: "Записка о Еве", next: "residential2" }
    ]
  },
  residential2: {
    location: "ЖИЛОЙ БЛОК // СОХРАНЕНИЕ",
    title: "Не первая смена",
    text: "За стеной кто-то повторяет твои движения с задержкой в одну секунду. Ты находишь план комплекса с несколькими зачёркнутыми помещениями. На полях — дата завтрашнего дня.",
    choices: [
      { id: "map", label: "Сверить план с коридором", result: "На плане отмечен проход за лифтом, которого нет на стене. Рядом стоит подпись «Комната наблюдения».", effects: { distortion: 2 }, addClue: "Искажённый план", next: "checkpoint" },
      { id: "wall", label: "Прислушаться к стене", result: "Шёпот повторяет твоё имя, затем говорит: «Ты уже здесь».", effects: { sanity: -7, suspicion: 3 }, next: "checkpoint" },
      { id: "leave", label: "Немедленно покинуть комнату", result: "Дверь закрывается за спиной. На секунду ручка поворачивается с другой стороны, но коридор пуст.", effects: { battery: -2 }, next: "checkpoint" }
    ]
  },
  medical: {
    location: "МЕДИЦИНСКИЙ СЕКТОР // ЗАПЕРТО",
    title: "Чужая карта",
    text: "За стеклом медицинского кабинета лежат карты пациентов. Одна из них подписана твоим именем, а дата поступления стоит семнадцать лет назад. Замок требует ручного доступа.",
    choices: [
      { id: "glass", label: "Осмотреть карту через стекло", result: "В графе «статус» написано: реконструкция памяти. Подпись врача неразборчива.", effects: { sanity: -5, distortion: 4 }, addClue: "Медицинская карта", next: "checkpoint" },
      { id: "panel", label: "Проверить панель доступа", result: "Панель сообщает: «Доступ разрешён только сотруднику, который уже вошёл».", effects: { suspicion: 4 }, next: "checkpoint" },
      { id: "call", label: "Вызвать дежурного по связи", result: "В ответ звучит голос Евы: «Не открывай кабинет. Там не ты» — и связь обрывается.", effects: { evaTrust: -1, sanity: -2 }, next: "checkpoint" }
    ]
  },
  archive: {
    location: "АРХИВ // УРОВЕНЬ ДОСТУПА 2",
    title: "Дверь не забывает",
    text: "Архив закрыт, но терминал показывает список документов, доступных Оператору-0. Время последнего входа — 03:17. Время следующего входа — тоже 03:17.",
    choices: [
      { id: "terminal", label: "Попытаться войти как Оператор-0", result: "Терминал просит подтвердить, что ты понимаешь последствия повторного доступа.", effects: { distortion: 3 }, next: "checkpoint" },
      { id: "search", label: "Искать журнал доступа", result: "В журнале десятки входов с твоим идентификатором. Все записи сделаны в разные годы.", effects: { sanity: -4 }, addClue: "Журнал доступа", next: "checkpoint" },
      { id: "retreat", label: "Отойти от двери", result: "Красный индикатор гаснет. За дверью раздаётся тихий голос: «Спасибо».", effects: { suspicion: -2 }, next: "checkpoint" }
    ]
  },
  checkpoint: {
    location: "КОНТРОЛЬНАЯ ТОЧКА // 03:17",
    title: "Сигнал повторяется",
    text: "Радио оживает. На этот раз голос не предупреждает тебя. Он задаёт вопрос: «Ты помнишь, кто запер дверь?» Перед тобой три активных канала связи.",
    choices: [
      { id: "eva", label: "Вызвать Еву Морозову", result: "Женщина отвечает после долгой паузы: «Я надеялась, что ты не дойдёшь до этого места».", effects: { evaTrust: 1 }, next: "eva" },
      { id: "operator", label: "Вызвать Оператора-0", result: "В динамике звучит твой голос, но старше и усталее: «Не позволяй мне закончить цикл».", effects: { sanity: -5, distortion: 5 }, next: "operator" },
      { id: "silence", label: "Отключить все каналы", result: "Тишина длится девять секунд. Затем стук раздаётся изнутри выключенного динамика.", effects: { suspicion: -3, distortion: 2 }, next: "operator" }
    ]
  },
  eva: {
    location: "ЗАЩИЩЁННЫЙ КАНАЛ // ЕВА",
    title: "Женщина в медицинском секторе",
    text: "Ева говорит, что может помочь выбраться, но просит не читать медицинские записи. Она утверждает, что Смотритель защищает источник. Её слова противоречат найденной записке.",
    choices: [
      { id: "trust", label: "Согласиться следовать её указаниям", result: "Ева передаёт временный код. В её голосе слышно облегчение — или хорошо сыгранная эмоция.", effects: { evaTrust: 2 }, next: "operator" },
      { id: "confront", label: "Предъявить ей найденную записку", result: "Ева замолкает. «Значит, архив уже начал вспоминать», — отвечает она.", effects: { evaTrust: -1, distortion: 3 }, next: "operator" },
      { id: "lie", label: "Сказать, что ты ничего не нашёл", result: "Ева сообщает код доступа и предупреждает, что Смотритель реагирует на свет.", effects: { evaTrust: 1, suspicion: -1 }, next: "operator" }
    ]
  },
  operator: {
    location: "АРХИВ // НЕИЗВЕСТНЫЙ ИСТОЧНИК",
    title: "Оператор-0 отвечает",
    text: "Голос просит тебя найти оригинальный журнал эксперимента. «Не верь записям, в которых я говорю, что хочу выйти. Я хотел, чтобы кто-то занял моё место». За стеной медленно движется тень.",
    choices: [
      { id: "journal", label: "Искать оригинальный журнал", result: "Ты находишь ссылку на закрытый лабораторный сектор. В журнале отсутствует последняя страница.", effects: { distortion: 3 }, addClue: "Ссылка на оригинальный журнал", next: "source" },
      { id: "ask", label: "Спросить, кто ты на самом деле", result: "«Я — то, что осталось после того, как ты забыл». Голос повторяет твоё дыхание.", effects: { sanity: -8, distortion: 6 }, next: "source" },
      { id: "cut", label: "Оборвать связь", result: "Канал отключается, но на панели остаётся гореть индикатор микрофона. Кто-то слушает.", effects: { suspicion: 5 }, next: "source" }
    ]
  },
  source: {
    location: "ИССЛЕДОВАТЕЛЬСКИЙ СЕКТОР // ИСТОЧНИК",
    title: "То, что повторяет",
    text: "За герметичной дверью работает установка без внешнего питания. Внутри — пустая камера и десятки магнитных лент с голосами исчезнувших сотрудников. На одной ленте написано твоё имя.",
    choices: [
      { id: "play", label: "Прослушать ленту со своим именем", result: "На записи ты говоришь: «Если ты дошёл до источника, значит, я не смог тебя остановить».", effects: { sanity: -6, distortion: 7 }, addClue: "Лента с собственным именем", next: "protocol" },
      { id: "power", label: "Изучить питание установки", result: "Установка подключена к аварийному генератору, который по журналу отключён семнадцать лет назад.", effects: { suspicion: 3 }, next: "protocol" },
      { id: "glass", label: "Посмотреть в стекло камеры", result: "Отражение показывает комнату, заполненную людьми. Все они смотрят на тебя и беззвучно повторяют одно слово: «Смена».", effects: { sanity: -9, distortion: 8 }, next: "protocol" }
    ]
  },
  protocol: {
    location: "ПОСЛЕДНИЙ ПРОТОКОЛ // 03:17",
    title: "Три команды",
    text: "Терминал предлагает три протокола. У тебя нет полного понимания последствий. Найденные улики, доверие Евы и уровень искажения определят, какие финальные события станут доступны.",
    choices: [
      { id: "evacuate", label: "Запустить эвакуацию комплекса", result: "Сирены включаются. Двери наружу начинают открываться, но в радио уже звучит голос следующего оператора.", effects: { suspicion: 8 }, ending: "evacuation" },
      { id: "contain", label: "Изолировать источник", result: "Система просит биометрическое подтверждение. Терминал узнаёт тебя прежде, чем ты касаешься панели.", effects: { distortion: 8 }, ending: "watcher" },
      { id: "reset", label: "Перезапустить эксперимент", result: "Свет гаснет. В темноте кто-то садится в операторское кресло. Смена начинается снова.", effects: { distortion: 10 }, ending: "quiet" }
    ]
  }
};

const endings = {
  evacuation: { title: "ЭВАКУАЦИЯ", text: "Ты выходишь из комплекса на холодный рассвет. Телефон ловит сеть. В последнем уведомлении — аудиозапись, созданная прямо сейчас: «Оператор, не выходи в коридор»." },
  watcher: { title: "НОВЫЙ СМОТРИТЕЛЬ", text: "Источник принимает подтверждение. На мониторе появляется силуэт в операторской. Ты пытаешься поднять руку — фигура повторяет движение с задержкой в одну секунду. Теперь ты следишь за следующей сменой." },
  zero: { title: "НУЛЕВОЙ ПАЦИЕНТ", text: "Медицинский архив раскрывает последний файл: твоя личность собрана из записей исчезнувшего сотрудника. За дверью слышится голос: «Ты готов к первой смене?»" },
  break: { title: "РАЗОРВАТЬ ЦИКЛ", text: "Ты отключаешь источник, используя сведения из архива, медицинского сектора и записей Оператора-0. Все мониторы гаснут. В полной темноте впервые за ночь не слышно ни одного звука." },
  quiet: { title: "ТИХАЯ СМЕНА", text: "Комплекс снова работает. Вентиляция гудит, камеры показывают пустые коридоры. На экране появляется сообщение: НОВЫЙ ОПЕРАТОР ПРИБЫВАЕТ В 23:40." }
};

async function loadSave(userId) {
  if (pool) {
    const result = await pool.query("SELECT save_data FROM game_saves WHERE telegram_id=$1", [userId]);
    return result.rows[0]?.save_data || null;
  }
  return memorySaves.get(userId) || null;
}
async function storeSave(userId, save) {
  save.updatedAt = new Date().toISOString();
  if (pool) {
    await pool.query(
      `INSERT INTO game_saves(telegram_id, save_data, updated_at) VALUES($1,$2,NOW())
       ON CONFLICT(telegram_id) DO UPDATE SET save_data=EXCLUDED.save_data, updated_at=NOW()`,
      [userId, JSON.stringify(save)]
    );
  } else {
    memorySaves.set(userId, save);
  }
}
function getUserId(req) {
  const initData = req.get("x-telegram-init-data") || "";
  return validateTelegramInitData(initData);
}
function requireTelegram(req, res, next) {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Открой игру через Telegram-бота. Проверка Telegram не пройдена." });
  req.telegramUserId = userId;
  next();
}

app.get("/health", (_req, res) => res.json({ ok: true, game: "SECTOR-9: ЭХО" }));

app.get("/api/session", requireTelegram, async (req, res) => {
  try {
    let save = await loadSave(req.telegramUserId);
    if (!save) {
      save = makeInitialSave();
      await storeSave(req.telegramUserId, save);
    }
    res.json({ save, scene: scenes[save.scene] || scenes.intro, database: !!pool });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Не удалось загрузить сохранение." });
  }
});

app.post("/api/new-game", requireTelegram, async (req, res) => {
  const difficulty = ["easy", "medium", "terror"].includes(req.body?.difficulty) ? req.body.difficulty : "medium";
  const save = makeInitialSave(difficulty);
  try {
    await storeSave(req.telegramUserId, save);
    res.json({ save, scene: scenes.intro, database: !!pool });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Не удалось создать игру." });
  }
});

app.post("/api/choose", requireTelegram, async (req, res) => {
  const { choiceId } = req.body || {};
  try {
    const save = await loadSave(req.telegramUserId);
    if (!save) return res.status(400).json({ error: "Сохранение не найдено. Начни новую игру." });
    const scene = scenes[save.scene];
    const choice = scene?.choices?.find(c => c.id === choiceId);
    if (!choice) return res.status(400).json({ error: "Такого действия нет в текущей сцене." });

    const effects = choice.effects || {};
    for (const [key, value] of Object.entries(effects)) {
      if (typeof save.stats[key] === "number") save.stats[key] += value;
    }
    save.stats.health = Math.max(0, Math.min(100, save.stats.health));
    save.stats.sanity = Math.max(0, Math.min(100, save.stats.sanity));
    save.stats.battery = Math.max(0, Math.min(100, save.stats.battery));
    save.stats.suspicion = Math.max(0, Math.min(100, save.stats.suspicion));
    save.stats.distortion = Math.max(0, Math.min(100, save.stats.distortion));
    if (choice.addClue && !save.clues.includes(choice.addClue)) save.clues.push(choice.addClue);
    if (choice.addItem && !save.inventory.includes(choice.addItem)) {
      if (save.inventory.length < 6) save.inventory.push(choice.addItem);
    }
    save.history.push({ scene: save.scene, choice: choice.label, result: choice.result, at: new Date().toISOString() });

    if (choice.ending) {
      let endingId = choice.ending;
      if (save.stats.distortion >= 30 && save.clues.length >= 4) endingId = "zero";
      if (save.stats.distortion >= 45 && save.clues.length >= 6 && save.stats.evaTrust <= 0) endingId = "break";
      const ending = endings[endingId] || endings.evacuation;
      save.ending = { id: endingId, ...ending };
      save.scene = "ending";
      save.lastResult = choice.result;
    } else {
      save.scene = choice.next;
      save.lastResult = choice.result;
    }
    await storeSave(req.telegramUserId, save);
    res.json({ save, scene: save.scene === "ending" ? null : scenes[save.scene], ending: save.ending || null, result: save.lastResult, database: !!pool });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Не удалось сохранить действие." });
  }
});

if (BOT_TOKEN) {
  const bot = new TelegramBot(BOT_TOKEN, { polling: true });
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const keyboard = APP_URL
      ? { inline_keyboard: [[{ text: "☠️ ОТКРЫТЬ SECTOR-9: ЭХО", web_app: { url: APP_URL } }]] }
      : { inline_keyboard: [[{ text: "Откройте игру после настройки APP_URL", callback_data: "missing_url" }]] };
    await bot.sendMessage(chatId,
      "⛧ SECTOR-9: ЭХО ⛧\n\nСектор закрыт 17 лет назад. Сегодня ночью он снова вышел на связь.\n\nНе доверяй голосу из радио.\nНе верь камерам.\nИ если услышишь собственный голос — не отвечай.",
      { reply_markup: keyboard }
    );
  });
  bot.on("polling_error", (err) => console.error("Telegram polling error:", err.message));
  console.log("Telegram bot polling enabled.");
} else {
  console.warn("BOT_TOKEN is missing. Web preview works locally, but Telegram bot is disabled.");
}

initDb().then(() => {
  app.listen(PORT, () => console.log(`SECTOR-9: ЭХО listening on ${PORT}`));
}).catch((err) => {
  console.error("Database initialization failed:", err);
  process.exit(1);
});

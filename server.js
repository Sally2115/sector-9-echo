
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

const CHAPTERS = [
  { id: 1, title: "Последняя смена" },
  { id: 2, title: "Под землёй" },
  { id: 3, title: "Кольцо брата" },
  { id: 4, title: "Три Смотрителя" },
  { id: 5, title: "Комната памяти" },
  { id: 6, title: "Доктор Морозова" },
  { id: 7, title: "Чёрная плёнка" },
  { id: 8, title: "Оператор-0" },
  { id: 9, title: "Лаборатория Эхо" },
  { id: 10, title: "Живой архив" },
  { id: 11, title: "Последний протокол" },
  { id: 12, title: "После сигнала" }
];

const endings = {
  evacuation: {
    title: "ЭВАКУАЦИЯ",
    text: "Ты выходишь из комплекса на холодный рассвет. Телефон ловит сеть. В последнем уведомлении появляется аудиозапись: «Оператор, не выходи в коридор»."
  },
  watcher: {
    title: "НОВЫЙ СМОТРИТЕЛЬ",
    text: "Источник принимает подтверждение. На мониторе появляется силуэт в операторской. Ты пытаешься поднять руку — фигура повторяет движение с задержкой в одну секунду. Теперь ты следишь за следующей сменой."
  },
  zero: {
    title: "НУЛЕВОЙ ПАЦИЕНТ",
    text: "Архив раскрывает последний файл. Твоя личность собрана из записей исчезнувшего сотрудника. За дверью звучит вопрос: «Ты готов к первой смене?»"
  },
  break: {
    title: "РАЗОРВАТЬ ЦИКЛ",
    text: "Ты отключаешь источник. Мониторы гаснут. В полной темноте впервые за ночь не слышно ни одного звука."
  },
  quiet: {
    title: "ТИХАЯ СМЕНА",
    text: "Комплекс снова работает. Камеры показывают пустые коридоры. На экране появляется сообщение: НОВЫЙ ОПЕРАТОР ПРИБЫВАЕТ В 23:40."
  }
};

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function makeInitialSave(difficulty = "medium") {
  return {
    version: 2,
    difficulty,
    chapter: 1,
    unlockedChapters: [1],
    completedChapters: [],
    scene: "intro",
    stats: {
      health: 100,
      sanity: 100,
      battery: difficulty === "easy" ? 100 : difficulty === "terror" ? 55 : 82,
      suspicion: difficulty === "terror" ? 20 : 8,
      distortion: 0,
      evaTrust: 0
    },
    inventory: ["Фонарик", "Диктофон"],
    clues: [],
    flags: {},
    history: [],
    deathUntil: null,
    ending: null,
    updatedAt: new Date().toISOString()
  };
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

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const a = Buffer.from(calculatedHash, "hex");
  const b = Buffer.from(hash, "hex");

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Date.now() / 1000 - authDate > 86400) {
    return null;
  }

  try {
    const user = JSON.parse(params.get("user") || "{}");
    return user.id ? String(user.id) : null;
  } catch {
    return null;
  }
}

function getUserId(req) {
  return validateTelegramInitData(req.get("x-telegram-init-data") || "");
}

function requireTelegram(req, res, next) {
  const userId = getUserId(req);

  if (!userId) {
    return res.status(401).json({
      error: "Открой игру через Telegram-бота. Проверка Telegram не пройдена."
    });
  }

  req.telegramUserId = userId;
  next();
}

async function initDb() {
  if (!pool) {
    console.warn("DATABASE_URL отсутствует. Сохранения будут временными.");
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

async function loadSave(userId) {
  if (pool) {
    const result = await pool.query(
      "SELECT save_data FROM game_saves WHERE telegram_id = $1",
      [userId]
    );
    return result.rows[0]?.save_data || null;
  }

  return memorySaves.get(userId) || null;
}

async function storeSave(userId, save) {
  save.updatedAt = new Date().toISOString();

  if (pool) {
    await pool.query(
      `INSERT INTO game_saves (telegram_id, save_data, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (telegram_id)
       DO UPDATE SET save_data = EXCLUDED.save_data, updated_at = NOW()`,
      [userId, JSON.stringify(save)]
    );
  } else {
    memorySaves.set(userId, save);
  }
}

function makeScene(id, chapter, location, title, text, choices) {
  return { id, chapter, location, title, text, choices };
}

const scenes = {
  intro: makeScene(
    "intro", 1, "ОПЕРАТОРСКАЯ // 03:17",
    "Последняя смена",
    "Сектор-9 закрыли семнадцать лет назад. Тридцать восемь сотрудников исчезли за одну ночь. Ты сидишь перед тремя мониторами, когда радиоприёмник включается сам. Из динамика звучит твой собственный голос: «Если ты слышишь это, значит, я не смог выбраться». На экране появляется дата — ровно семнадцать лет назад.",
    [
      {
        id: "radio",
        label: "Записать сообщение на диктофон",
        result: "После твоего голоса на записи слышно дыхание другого человека. Он шепчет: «Он уже идёт».",
        effects: { sanity: -4, suspicion: 3 },
        clue: "Запись собственного голоса",
        next: "camera"
      },
      {
        id: "monitor",
        label: "Переключить камеры наблюдения",
        result: "На камере 05 в конце коридора стоит высокая фигура. На следующем кадре она оказывается у самой двери операторской.",
        effects: { battery: -4, suspicion: 8 },
        clue: "Фигура на камере 05",
        next: "badge"
      },
      {
        id: "badge",
        label: "Изучить пропуск на столе",
        result: "На пропуске твоё лицо. Дата выдачи — семнадцать лет назад. Под фотографией написано: ОПЕРАТОР-0.",
        effects: { distortion: 4 },
        clue: "Пропуск Оператора-0",
        item: "Пропуск Оператора-0",
        next: "hall"
      }
    ]
  ),

  camera: makeScene(
    "camera", 1, "ОПЕРАТОРСКАЯ // КАМЕРА 05",
    "Фигура",
    "Фигура стоит неподвижно, хотя на мониторе время продолжает идти. Ты увеличиваешь изображение. У фигуры нет лица — только тёмная поверхность, отражающая комнату, в которой ты сидишь.",
    [
      {
        id: "zoom",
        label: "Увеличить изображение",
        result: "На стекле проступает надпись: «НЕ СМОТРИ НАЗАД».",
        effects: { sanity: -5, battery: -3 },
        clue: "Надпись на стекле",
        next: "hall"
      },
      {
        id: "switch",
        label: "Переключить все камеры",
        result: "Фигура приближается с каждым переключением. На последнем экране она стоит прямо за твоим креслом.",
        effects: { suspicion: 12, sanity: -4 },
        next: "hall"
      },
      {
        id: "disconnect",
        label: "Отключить питание мониторов",
        result: "Экраны гаснут. В чёрном стекле ты видишь отражение человека, стоящего за твоим плечом.",
        effects: { sanity: -6, distortion: 4 },
        next: "hall"
      }
    ]
  ),

  badge: makeScene(
    "badge", 1, "ОПЕРАТОРСКАЯ // ДОКУМЕНТЫ",
    "Оператор-0",
    "Пропуск тёплый, словно его только что держали в руке. На обороте написано: «Если архив снова стёрт, не верь первому воспоминанию». За дверью слышится скрежет.",
    [
      {
        id: "pocket",
        label: "Забрать пропуск",
        result: "Ты прячешь пропуск. На панели доступа загорается новый сектор.",
        item: "Пропуск Оператора-0",
        next: "hall"
      },
      {
        id: "photo",
        label: "Сравнить фотографию с отражением",
        result: "На фотографии ты смотришь прямо в камеру. В отражении твои глаза закрыты.",
        effects: { sanity: -5, distortion: 4 },
        clue: "Искажённая фотография",
        next: "hall"
      },
      {
        id: "destroy",
        label: "Разорвать пропуск",
        result: "Пластик рвётся слишком легко. Внутри нет чипа — только тонкий слой фотобумаги.",
        effects: { distortion: 7, suspicion: 3 },
        next: "hall"
      }
    ]
  ),

  hall: makeScene(
    "hall", 1, "СЕКТОР A // КОРИДОР",
    "За дверью",
    "Коридор освещён одной красной лампой. Из динамика звучит короткий вдох. На полу свежие следы ведут к жилому блоку, медицинскому сектору и архиву. За спиной тихо щёлкает замок.",
    [
      {
        id: "residential",
        label: "Проверить жилой блок",
        result: "На двери комнаты выцарапано число 38. Изнутри доносится звук работающего телевизора.",
        effects: { battery: -3 },
        next: "room38"
      },
      {
        id: "medical",
        label: "Осмотреть медицинский сектор",
        result: "За стеклом человек в белом халате медленно поворачивает голову. Когда ты моргаешь, кабинет пуст.",
        effects: { sanity: -3, suspicion: 5 },
        clue: "Силуэт в медицинском секторе",
        next: "medical"
      },
      {
        id: "archive",
        label: "Проверить дверь архива",
        result: "Считыватель мигает красным. За дверью трижды стучат в ответ.",
        effects: { suspicion: 3 },
        next: "archive"
      }
    ]
  ),

  room38: makeScene(
    "room38", 1, "ЖИЛОЙ БЛОК // КОМНАТА 38",
    "Тёплый чай",
    "На столе стоит чашка с ещё тёплым чаем. На стене фотография команды Сектора-9. Одно лицо вырезано. На обороте снимка написано: «Мы не пропали. Нас повторили».",
    [
      {
        id: "photo",
        label: "Изучить фотографию",
        result: "Под вырезанным лицом проступает имя твоего брата.",
        effects: { distortion: 4 },
        clue: "Фотография команды",
        next: "watcher"
      },
      {
        id: "cup",
        label: "Осмотреть чашку",
        result: "На дне чашки лежит ключ с номером 09.",
        item: "Ключ 09",
        next: "watcher"
      },
      {
        id: "closet",
        label: "Открыть шкаф",
        result: "Внутри висит твоя рабочая куртка. В кармане записка: «Смотритель знает, что ты вернулся».",
        effects: { suspicion: 5 },
        clue: "Записка о Смотрителе",
        next: "watcher"
      }
    ]
  ),

  medical: makeScene(
    "medical", 1, "МЕДИЦИНСКИЙ СЕКТОР",
    "Чужая карта",
    "В карте пациента твоё имя. Дата поступления — семнадцать лет назад. В графе «статус» указано: реконструкция памяти.",
    [
      {
        id: "glass",
        label: "Прочитать медицинскую карту",
        result: "Подпись врача принадлежит Еве Морозовой.",
        effects: { sanity: -5, distortion: 3 },
        clue: "Медицинская карта",
        next: "watcher"
      },
      {
        id: "panel",
        label: "Проверить панель доступа",
        result: "Терминал сообщает: «Доступ разрешён сотруднику, который уже вошёл».",
        effects: { suspicion: 4 },
        next: "watcher"
      },
      {
        id: "call",
        label: "Вызвать Еву по связи",
        result: "Ева шепчет: «Не открывай кабинет. Там не ты».",
        effects: { evaTrust: 1, sanity: -2 },
        next: "watcher"
      }
    ]
  ),

  archive: makeScene(
    "archive", 1, "АРХИВ // УРОВЕНЬ 2",
    "Дверь не забывает",
    "На терминале отображается журнал доступа. Последний вход выполнен семнадцать лет назад. Пользователь: Оператор-0. Следующий вход назначен на 03:17.",
    [
      {
        id: "terminal",
        label: "Попробовать войти как Оператор-0",
        result: "Терминал принимает имя, но требует подтверждение личности.",
        effects: { distortion: 4 },
        clue: "Журнал доступа",
        next: "watcher"
      },
      {
        id: "search",
        label: "Скопировать журнал",
        result: "В журнале десятки входов с твоим идентификатором. Они сделаны в разные годы.",
        effects: { sanity: -4 },
        clue: "Журнал Оператора-0",
        next: "watcher"
      },
      {
        id: "retreat",
        label: "Отойти от двери",
        result: "За дверью звучит тихий голос: «Спасибо».",
        effects: { suspicion: -2 },
        next: "watcher"
      }
    ]
  ),

  watcher: makeScene(
    "watcher", 1, "КОРИДОР A // КОНТАКТ",
    "Смотритель",
    "Красная лампа гаснет. В конце коридора стоит высокий человек в старой форме персонала. На груди — табличка СМОТРИТЕЛЬ. Его лицо закрывает гладкая белая маска. Он не бежит. Он просто начинает идти к тебе.",
    [
      {
        id: "light",
        label: "Направить фонарь ему в лицо",
        result: "Смотритель наклоняет голову. В маске появляется отражение твоего лица.",
        effects: { battery: -8, suspicion: 10, sanity: -5 },
        next: "hide"
      },
      {
        id: "run",
        label: "Бежать к лифту",
        result: "Ты успеваешь добежать до лифта, но двери закрываются перед самым носом. Шаги уже рядом.",
        effects: { health: -10, suspicion: 12 },
        next: "hide"
      },
      {
        id: "hide",
        label: "Спрятаться в нише",
        result: "Ты замираешь. Смотритель останавливается у стены и произносит твоим голосом: «Я знаю, что ты здесь».",
        effects: { sanity: -8, suspicion: 6 },
        next: "captured"
      }
    ]
  ),

  hide: makeScene(
    "hide", 1, "СЕКТОР A // СЛЕПАЯ ЗОНА",
    "Тихо",
    "Ты пытаешься уйти от Смотрителя. Но коридор меняется, а двери ведут обратно к тому же месту. Шаги приближаются. Вентиляция внезапно замолкает.",
    [
      {
        id: "door",
        label: "Попытаться открыть аварийную дверь",
        result: "За дверью нет выхода. Только лестница вниз, в темноту.",
        effects: { health: -5, suspicion: 8 },
        next: "captured"
      },
      {
        id: "radio",
        label: "Позвать на помощь по радио",
        result: "Ответ приходит немедленно: «Помощь уже здесь». За спиной скрипит дверь.",
        effects: { sanity: -5, suspicion: 8 },
        next: "captured"
      },
      {
        id: "freeze",
        label: "Замереть и не двигаться",
        result: "Тишина длится несколько секунд. Затем чья-то рука хватает тебя за плечо.",
        effects: { health: -5, suspicion: 10 },
        next: "captured"
      }
    ]
  ),

  captured: makeScene(
    "captured", 1, "ПОДЗЕМНЫЙ УРОВЕНЬ // КАМЕРА 09",
    "Плен",
    "Ты приходишь в себя на холодном полу. Руки свободны, но дверь заперта снаружи. В стене встроен динамик. Смотритель говорит: «Ты всегда доходишь до этого места. Вопрос только в том, сколько раз ты успеешь забыть».",
    [
      {
        id: "door",
        label: "Осмотреть дверь камеры",
        result: "На внутренней стороне выцарапаны десятки одинаковых отметок. Кто-то пытался считать дни.",
        clue: "Отметки в камере",
        next: "basement"
      },
      {
        id: "vent",
        label: "Проверить вентиляцию",
        result: "За решёткой слышно, как кто-то шепчет твоё имя.",
        effects: { sanity: -4 },
        next: "basement"
      },
      {
        id: "speaker",
        label: "Ответить Смотрителю",
        result: "«Хорошо. Ты снова начал задавать вопросы», — говорит он.",
        effects: { suspicion: 5, distortion: 3 },
        next: "basement"
      }
    ]
  ),

  basement: makeScene(
    "basement", 2, "ПОДЗЕМНЫЙ УРОВЕНЬ // КАМЕРА 09",
    "Чужой пленник",
    "За соседней стеной слышится стук. В вентиляционном проёме ты находишь металлическую пластину, а за ней — узкий проход. Из соседней камеры кто-то отвечает на твои движения с задержкой.",
    [
      {
        id: "plate",
        label: "Снять металлическую пластину",
        result: "За пластиной лежит согнутый инструмент и клочок формы персонала.",
        item: "Согнутый инструмент",
        next: "escape"
      },
      {
        id: "neighbor",
        label: "Позвать соседа",
        result: "Голос отвечает: «Меня зовут Марк. Кажется. Я больше ничего не помню».",
        effects: { evaTrust: 1 },
        clue: "Голос из соседней камеры",
        next: "escape"
      },
      {
        id: "speaker",
        label: "Подслушать динамик",
        result: "Смотритель сообщает кому-то: «Субъект проснулся. Подготовить второй цикл».",
        effects: { suspicion: 3, distortion: 3 },
        clue: "Запись второго цикла",
        next: "escape"
      }
    ]
  ),

  escape: makeScene(
    "escape", 2, "ПОДЗЕМНЫЙ УРОВЕНЬ // ТЕХНИЧЕСКИЙ ПРОХОД",
    "Побег",
    "Проход выводит к технической двери. Марк появляется из темноты. Он не помнит, как попал сюда, но знает расположение лестниц. Его помощь кажется искренней.",
    [
      {
        id: "trust",
        label: "Довериться Марку",
        result: "Марк показывает путь к лестнице и просит не задавать вопросов о его прошлом.",
        effects: { evaTrust: 2 },
        next: "mark"
      },
      {
        id: "search",
        label: "Обыскать его форму",
        result: "Ты находишь карту доступа с выцарапанным номером 03. Марк уверяет, что никогда её не видел.",
        clue: "Карта доступа 03",
        next: "mark"
      },
      {
        id: "separate",
        label: "Идти впереди одному",
        result: "Марк следует за тобой на расстоянии. Ты слышишь, как он беззвучно повторяет твои движения.",
        effects: { suspicion: 3, sanity: -2 },
        next: "mark"
      }
    ]
  ),

  mark: makeScene(
    "mark", 2, "ЛЕСТНИЦА B // СТАРЫЙ ЛИФТ",
    "Союзник",
    "Марк помогает открыть лифт. Внутри на стене написано: «НЕ ПОДНИМАЙСЯ С НИМ». Марк говорит, что надпись появилась недавно. Но пыль вокруг неё нетронута.",
    [
      {
        id: "lift",
        label: "Войти в лифт вместе с Марком",
        result: "Лифт поднимается. Марк смотрит в угол и тихо произносит: «Да, я привёл его».",
        effects: { suspicion: 6, distortion: 4 },
        next: "betrayal"
      },
      {
        id: "stairs",
        label: "Продолжить по лестнице",
        result: "Лестница приводит к запертой двери. Марк открывает её раньше, чем ты успеваешь попросить.",
        effects: { suspicion: 3 },
        next: "betrayal"
      },
      {
        id: "question",
        label: "Спросить Марка, кто такой Смотритель",
        result: "Марк улыбается: «Он тот, кто не позволяет нам закончить смену». Его улыбка исчезает мгновенно.",
        effects: { sanity: -4, distortion: 5 },
        next: "betrayal"
      }
    ]
  ),

  betrayal: makeScene(
    "betrayal", 2, "ПОДЗЕМНЫЙ КОНТРОЛЬНЫЙ ПУНКТ",
    "Второй голос",
    "Дверь за вами закрывается. Марк встаёт у панели доступа и произносит фразу, которой его никто не учил: «Субъект доставлен». На соседнем экране появляется Смотритель.",
    [
      {
        id: "attack",
        label: "Попытаться обезоружить Марка",
        result: "Марк уклоняется от удара. Он двигается так, словно заранее видел твою попытку.",
        effects: { health: -10, suspicion: 10 },
        next: "alone"
      },
      {
        id: "escape",
        label: "Бежать к аварийному выходу",
        result: "Дверь захлопывается перед тобой. Марк даже не пытается тебя остановить.",
        effects: { health: -5, suspicion: 8 },
        next: "alone"
      },
      {
        id: "record",
        label: "Включить диктофон",
        result: "На записи голос Марка меняется. Теперь он звучит в точности как Смотритель.",
        clue: "Запись голоса Марка",
        effects: { distortion: 6 },
        next: "alone"
      }
    ]
  ),

  alone: makeScene(
    "alone", 3, "НИЖНИЙ УРОВЕНЬ // ОДИНОЧНАЯ КАМЕРА",
    "Снова один",
    "Ты приходишь в себя в другой камере. Марка нет. На полу лежит фотография твоего брата, а рядом — медицинский отчёт о трёх Смотрителях и вмешательстве в его мозг. В отчёте указано: субъект жив. Местоположение неизвестно.",
    [
      {
        id: "report",
        label: "Прочитать отчёт о брате",
        result: "Три Смотрителя проводили эксперименты по переносу памяти. Последняя запись подтверждает: твой брат пережил процедуру.",
        clue: "Отчёт об экспериментах над братом",
        effects: { sanity: -6, distortion: 4 },
        next: "ring"
      },
      {
        id: "photo",
        label: "Изучить фотографию",
        result: "На обороте написано: «Если он выжил, ищи кольцо у того, кто помнит слишком мало».",
        clue: "Фотография брата",
        next: "ring"
      },
      {
        id: "panel",
        label: "Проверить терминал камеры",
        result: "Терминал показывает три биометрических профиля Смотрителя. У всех один источник памяти.",
        clue: "Три профиля Смотрителя",
        effects: { distortion: 5 },
        next: "ring"
      }
    ]
  ),

  ring: makeScene(
    "ring", 3, "НИЖНИЙ УРОВЕНЬ // КОРИДОР",
    "Кольцо",
    "Через стекло ты видишь Марка на другом конце коридора. На его руке кольцо твоего брата. Марк замечает твой взгляд и прячет руку. Теперь тебе нужно вернуть кольцо и узнать, где держат брата.",
    [
      {
        id: "follow",
        label: "Тихо проследить за Марком",
        result: "Марк направляется к лифту с красной меткой. Ты запоминаешь маршрут.",
        effects: { suspicion: 2 },
        clue: "Маршрут Марка",
        next: "chapter_end"
      },
      {
        id: "confront",
        label: "Потребовать вернуть кольцо",
        result: "Марк смотрит на кольцо так, будто впервые его видит. Затем произносит: «Он сказал, что ты спросишь».",
        effects: { sanity: -4, suspicion: 8 },
        clue: "Кольцо брата",
        next: "chapter_end"
      },
      {
        id: "record",
        label: "Записать разговор на диктофон",
        result: "На записи слышно ещё два голоса, говорящих одновременно с Марком.",
        effects: { distortion: 6 },
        clue: "Два голоса Марка",
        next: "chapter_end"
      }
    ]
  ),

  chapter_end: makeScene(
    "chapter_end", 3, "СЕКТОР B // ПЕРЕХОД",
    "Следующая дверь",
    "Ты остаёшься один перед запертой дверью. За ней находится сектор, в котором исчез след Марка. На терминале появляется надпись: «ГЛАВА ЗАВЕРШЕНА».",
    [
      {
        id: "continue",
        label: "Открыть следующий сектор",
        result: "Замок щёлкает. Из темноты доносится голос Евы: «Теперь ты знаешь достаточно, чтобы начать бояться по-настоящему».",
        next: "chapter4"
      },
      {
        id: "archive",
        label: "Сохранить найденные улики",
        result: "Все улики занесены в архив. Среди файлов появляется новый документ: ПРОТОКОЛ ТРЁХ.",
        clue: "Протокол трёх",
        next: "chapter4"
      },
      {
        id: "rest",
        label: "Перевести дыхание",
        result: "Ты восстанавливаешь силы, но где-то наверху слышен звук открывающейся двери.",
        effects: { health: 10, sanity: 5 },
        next: "chapter4"
      }
    ]
  )
};

function createLaterScene(chapter) {
  const title = CHAPTERS[chapter - 1].title;

  return makeScene(
    `chapter${chapter}`,
    chapter,
    `СЕКТОР-9 // ГЛАВА ${String(chapter).padStart(2, "0")}`,
    title,
    "Сектор меняется вокруг тебя. Записи указывают на эксперименты над памятью, а каждый новый коридор напоминает место, которого ты не помнишь. Смотритель где-то рядом. Тебе нужно решить, чему верить.",
    [
      {
        id: "investigate",
        label: "Изучить следы эксперимента",
        result: "Ты находишь новые документы и добавляешь их в архив улик.",
        clue: `Документы главы ${chapter}`,
        effects: { distortion: 3 },
        next: `chapter${chapter}b`
      },
      {
        id: "move",
        label: "Продвинуться в следующий сектор",
        result: "Ты проходишь через служебный коридор, но слышишь шаги за спиной.",
        effects: { suspicion: 5, battery: -3 },
        next: `chapter${chapter}b`
      },
      {
        id: "hide",
        label: "Выждать в укрытии",
        result: "Шаги удаляются. Ты используешь паузу, чтобы восстановить дыхание.",
        effects: { sanity: 2, suspicion: -3 },
        next: `chapter${chapter}b`
      }
    ]
  );
}

function makeChapterScenes(chapter) {
  const id = `chapter${chapter}b`;
  const nextChapter = chapter === 12 ? null : chapter + 1;

  return makeScene(
    id,
    chapter,
    `СЕКТОР-9 // КОНТРОЛЬНАЯ ТОЧКА ${chapter}`,
    "Выбор протокола",
    "Терминал предлагает три действия. Каждое решение оставляет след в системе. Ты не знаешь, кто прочитает эти записи.",
    [
      {
        id: "continue",
        label: nextChapter ? "Продолжить исследование" : "Добраться до источника",
        result: nextChapter
          ? "Ты открываешь следующий сектор. Комплекс регистрирует твой проход."
          : "Ты добираешься до центрального терминала. На экране появляется последнее предупреждение.",
        next: nextChapter ? `chapter${nextChapter}` : "finalProtocol"
      },
      {
        id: "search",
        label: "Собрать доказательства",
        result: "Ты копируешь записи из терминала и сохраняешь их в архиве.",
        clue: `Запись терминала ${chapter}`,
        effects: { distortion: 3 },
        next: nextChapter ? `chapter${nextChapter}` : "finalProtocol"
      },
      {
        id: "recover",
        label: "Восстановить силы",
        result: "Ты находишь аптечку и несколько запасных батарей.",
        effects: { health: 10, sanity: 5, battery: 10 },
        next: nextChapter ? `chapter${nextChapter}` : "finalProtocol"
      }
    ]
  );
}

const scenes = {
  intro: makeScene(
    "intro", 1, "ОПЕРАТОРСКАЯ // 03:17",
    "Последняя смена",
    "Сектор-9 закрыли семнадцать лет назад. Тридцать восемь сотрудников исчезли за одну ночь. На трёх мониторах пустые коридоры. Радиоприёмник включается сам. Из динамика звучит твой собственный голос: «Если ты слышишь это, значит, я не смог выбраться».",
    [
      {
        id: "radio",
        label: "Записать сообщение",
        result: "После твоего голоса слышно дыхание другого человека. Он шепчет: «Он уже идёт».",
        effects: { sanity: -4, suspicion: 3 },
        clue: "Запись собственного голоса",
        next: "camera"
      },
      {
        id: "monitor",
        label: "Осмотреть камеры",
        result: "На камере 05 стоит высокая фигура. При следующем переключении она оказывается у двери.",
        effects: { battery: -4, suspicion: 8 },
        clue: "Фигура на камере",
        next: "badge"
      },
      {
        id: "badge",
        label: "Изучить пропуск",
        result: "На пропуске твоё лицо. Дата выдачи — семнадцать лет назад. Под фотографией написано: ОПЕРАТОР-0.",
        effects: { distortion: 4 },
        clue: "Пропуск Оператора-0",
        item: "Пропуск Оператора-0",
        next: "hall"
      }
    ]
  ),

  camera: makeScene(
    "camera", 1, "ОПЕРАТОРСКАЯ // КАМЕРА 05",
    "Фигура",
    "На стекле камеры проступает надпись: «НЕ СМОТРИ НАЗАД». Фигура приближается с каждым кадром.",
    [
      { id: "zoom", label: "Увеличить изображение", result: "Фигура смотрит прямо в объектив.", effects: { sanity: -5, battery: -3 }, next: "hall" },
      { id: "switch", label: "Переключить камеры", result: "На каждом экране фигура становится ближе.", effects: { suspicion: 12, sanity: -4 }, next: "hall" },
      { id: "disconnect", label: "Отключить мониторы", result: "В чёрном стекле ты видишь силуэт за своим плечом.", effects: { sanity: -6, distortion: 4 }, next: "hall" }
    ]
  ),

  badge: makeScene(
    "badge", 1, "ОПЕРАТОРСКАЯ // ДОКУМЕНТЫ",
    "Оператор-0",
    "На обороте пропуска написано: «Если архив снова стёрт, не верь первому воспоминанию». За дверью слышится скрежет.",
    [
      { id: "pocket", label: "Забрать пропуск", result: "Ты прячешь пропуск. На панели доступа загорается новый сектор.", item: "Пропуск Оператора-0", next: "hall" },
      { id: "photo", label: "Сравнить фотографию с отражением", result: "На фотографии ты смотришь прямо в камеру. В отражении твои глаза закрыты.", effects: { sanity: -5, distortion: 4 }, clue: "Искажённая фотография", next: "hall" },
      { id: "destroy", label: "Разорвать пропуск", result: "Внутри нет чипа — только тонкий слой фотобумаги.", effects: { distortion: 7, suspicion: 3 }, next: "hall" }
    ]
  ),

  hall: makeScene(
    "hall", 1, "СЕКТОР A // КОРИДОР",
    "За дверью",
    "Коридор освещён одной красной лампой. Следы ведут к жилому блоку, медицинскому сектору и архиву. За спиной щёлкает замок.",
    [
      { id: "residential", label: "Проверить жилой блок", result: "На двери выцарапано число 38.", effects: { battery: -3 }, next: "room38" },
      { id: "medical", label: "Осмотреть медицинский сектор", result: "За стеклом человек в белом халате медленно поворачивает голову.", effects: { sanity: -3, suspicion: 5 }, clue: "Силуэт в медицинском секторе", next: "medical" },
      { id: "archive", label: "Проверить дверь архива", result: "За дверью трижды стучат в ответ.", effects: { suspicion: 3 }, next: "archive" }
    ]
  ),

  room38: makeScene(
    "room38", 1, "ЖИЛОЙ БЛОК // КОМНАТА 38",
    "Тёплый чай",
    "На столе стоит чашка с ещё тёплым чаем. На стене фотография команды Сектора-9. Одно лицо вырезано. На обороте написано: «Мы не пропали. Нас повторили».",
    [
      { id: "photo", label: "Изучить фотографию", result: "Под вырезанным лицом проступает имя твоего брата.", effects: { distortion: 4 }, clue: "Фотография команды", next: "watcher" },
      { id: "cup", label: "Осмотреть чашку", result: "На дне чашки лежит ключ с номером 09.", item: "Ключ 09", next: "watcher" },
      { id: "closet", label: "Открыть шкаф", result: "В кармане куртки записка: «Смотритель знает, что ты вернулся».", effects: { suspicion: 5 }, clue: "Записка о Смотрителе", next: "watcher" }
    ]
  ),

  medical: makeScene(
    "medical", 1, "МЕДИЦИНСКИЙ СЕКТОР",
    "Чужая карта",
    "В карте пациента твоё имя. Дата поступления — семнадцать лет назад. Статус: реконструкция памяти.",
    [
      { id: "glass", label: "Прочитать медицинскую карту", result: "Подпись врача принадлежит Еве Морозовой.", effects: { sanity: -5, distortion: 3 }, clue: "Медицинская карта", next: "watcher" },
      { id: "panel", label: "Проверить панель доступа", result: "«Доступ разрешён сотруднику, который уже вошёл».", effects: { suspicion: 4 }, next: "watcher" },
      { id: "call", label: "Вызвать Еву", result: "Ева шепчет: «Не открывай кабинет. Там не ты».", effects: { evaTrust: 1, sanity: -2 }, next: "watcher" }
    ]
  ),

  archive: makeScene(
    "archive", 1, "АРХИВ // УРОВЕНЬ 2",
    "Дверь не забывает",
    "В журнале десятки входов с твоим идентификатором. Все они сделаны в разные годы. Следующий вход назначен на 03:17.",
    [
      { id: "terminal", label: "Войти как Оператор-0", result: "Терминал требует подтверждение личности.", effects: { distortion: 4 }, next: "watcher" },
      { id: "search", label: "Скопировать журнал", result: "Архив сохраняет список неизвестных входов.", effects: { sanity: -4 }, clue: "Журнал Оператора-0", next: "watcher" },
      { id: "retreat", label: "Отойти от двери", result: "За дверью звучит тихое: «Спасибо».", effects: { suspicion: -2 }, next: "watcher" }
    ]
  ),

  watcher: makeScene(
    "watcher", 1, "КОРИДОР A // КОНТАКТ",
    "Смотритель",
    "Красная лампа гаснет. В конце коридора стоит человек в старой форме. Его лицо закрывает гладкая белая маска. Он начинает идти к тебе.",
    [
      { id: "light", label: "Направить фонарь в лицо", result: "В маске отражается твоё лицо.", effects: { battery: -8, suspicion: 10, sanity: -5 }, next: "hide" },
      { id: "run", label: "Бежать к лифту", result: "Двери закрываются перед самым носом. Шаги уже рядом.", effects: { health: -10, suspicion: 12 }, next: "hide" },
      { id: "hide", label: "Спрятаться в нише", result: "Смотритель останавливается у стены: «Я знаю, что ты здесь».", effects: { sanity: -8, suspicion: 6 }, next: "captured" }
    ]
  ),

  hide: makeScene(
    "hide", 1, "СЕКТОР A // СЛЕПАЯ ЗОНА",
    "Тихо",
    "Коридор меняется, двери ведут обратно, а шаги приближаются. Вентиляция внезапно замолкает.",
    [
      { id: "door", label: "Открыть аварийную дверь", result: "За дверью лестница вниз, в темноту.", effects: { health: -5, suspicion: 8 }, next: "captured" },
      { id: "radio", label: "Позвать на помощь", result: "В радио отвечают: «Помощь уже здесь».", effects: { sanity: -5, suspicion: 8 }, next: "captured" },
      { id: "freeze", label: "Замереть", result: "Чья-то рука хватает тебя за плечо.", effects: { health: -5, suspicion: 10 }, next: "captured" }
    ]
  ),

  captured: makeScene(
    "captured", 1, "ПОДЗЕМНЫЙ УРОВЕНЬ // КАМЕРА 09",
    "Плен",
    "Ты приходишь в себя на холодном полу. Дверь заперта снаружи. Смотритель говорит: «Ты всегда доходишь до этого места».",
    [
      { id: "door", label: "Осмотреть дверь", result: "На внутренней стороне выцарапаны десятки одинаковых отметок.", clue: "Отметки в камере", next: "basement" },
      { id: "vent", label: "Проверить вентиляцию", result: "За решёткой слышно, как кто-то шепчет твоё имя.", effects: { sanity: -4 }, next: "basement" },
      { id: "speaker", label: "Ответить Смотрителю", result: "«Хорошо. Ты снова начал задавать вопросы».", effects: { suspicion: 5, distortion: 3 }, next: "basement" }
    ]
  ),

  basement: makeScene(
    "basement", 2, "ПОДЗЕМНЫЙ УРОВЕНЬ // КАМЕРА 09",
    "Чужой пленник",
    "За стеной слышится стук. В вентиляционном проёме ты находишь металлическую пластину. За ней — узкий проход. Кто-то из соседней камеры повторяет твои движения с задержкой.",
    [
      { id: "plate", label: "Снять металлическую пластину", result: "За пластиной лежит согнутый инструмент.", item: "Согнутый инструмент", next: "escape" },
      { id: "neighbor", label: "Позвать соседа", result: "Голос отвечает: «Меня зовут Марк. Кажется. Я больше ничего не помню».", clue: "Голос из соседней камеры", next: "escape" },
      { id: "speaker", label: "Подслушать динамик", result: "Смотритель сообщает: «Субъект проснулся. Подготовить второй цикл».", effects: { distortion: 3 }, clue: "Запись второго цикла", next: "escape" }
    ]
  ),

  escape: makeScene(
    "escape", 2, "ПОДЗЕМНЫЙ УРОВЕНЬ // ПРОХОД",
    "Побег",
    "Проход выводит к технической двери. Марк появляется из темноты. Он не помнит, как попал сюда, но знает расположение лестниц.",
    [
      { id: "trust", label: "Довериться Марку", result: "Марк показывает путь к лестнице.", effects: { evaTrust: 2 }, next: "mark" },
      { id: "search", label: "Обыскать его форму", result: "Ты находишь карту доступа с номером 03.", clue: "Карта доступа 03", next: "mark" },
      { id: "separate", label: "Идти впереди одному", result: "Марк следует за тобой и повторяет твои движения.", effects: { suspicion: 3 }, next: "mark" }
    ]
  ),

  mark: makeScene(
    "mark", 2, "ЛЕСТНИЦА B // СТАРЫЙ ЛИФТ",
    "Союзник",
    "На стене лифта написано: «НЕ ПОДНИМАЙСЯ С НИМ». Марк говорит, что надпись появилась недавно. Пыль вокруг неё нетронута.",
    [
      { id: "lift", label: "Войти в лифт с Марком", result: "Марк шепчет: «Да, я привёл его».", effects: { suspicion: 6, distortion: 4 }, next: "betrayal" },
      { id: "stairs", label: "Продолжить по лестнице", result: "Марк открывает запертую дверь раньше, чем ты успеваешь попросить.", effects: { suspicion: 3 }, next: "betrayal" },
      { id: "question", label: "Спросить о Смотрителе", result: "«Он тот, кто не позволяет нам закончить смену», — отвечает Марк.", effects: { sanity: -4, distortion: 5 }, next: "betrayal" }
    ]
  ),

  betrayal: makeScene(
    "betrayal", 2, "ПОДЗЕМНЫЙ КОНТРОЛЬНЫЙ ПУНКТ",
    "Второй голос",
    "Дверь закрывается. Марк встаёт у панели и произносит: «Субъект доставлен». На соседнем экране появляется Смотритель.",
    [
      { id: "attack", label: "Обезоружить Марка", result: "Марк уклоняется от удара так, словно заранее видел твою попытку.", effects: { health: -10, suspicion: 10 }, next: "alone" },
      { id: "escape", label: "Бежать к аварийному выходу", result: "Дверь захлопывается. Марк даже не пытается тебя остановить.", effects: { health: -5, suspicion: 8 }, next: "alone" },
      { id: "record", label: "Включить диктофон", result: "Голос Марка меняется и становится голосом Смотрителя.", effects: { distortion: 6 }, clue: "Запись голоса Марка", next: "alone" }
    ]
  ),

  alone: makeScene(
    "alone", 3, "НИЖНИЙ УРОВЕНЬ // КАМЕРА",
    "Снова один",
    "Ты приходишь в себя в другой камере. На полу фотография брата и отчёт о трёх Смотрителях. Они экспериментировали над его мозгом. Последняя запись подтверждает: брат жив, но его местоположение неизвестно.",
    [
      { id: "report", label: "Прочитать отчёт", result: "Три Смотрителя проводили эксперименты по переносу памяти.", clue: "Отчёт об экспериментах над братом", effects: { sanity: -6, distortion: 4 }, next: "ring" },
      { id: "photo", label: "Изучить фотографию", result: "На обороте написано: «Ищи кольцо у того, кто помнит слишком мало».", clue: "Фотография брата", next: "ring" },
      { id: "panel", label: "Проверить терминал", result: "У трёх профилей Смотрителя один источник памяти.", clue: "Три профиля Смотрителя", effects: { distortion: 5 }, next: "ring" }
    ]
  ),

  ring: makeScene(
    "ring", 3, "НИЖНИЙ УРОВЕНЬ // КОРИДОР",
    "Кольцо брата",
    "Через стекло ты видишь Марка на другом конце коридора. На его руке кольцо твоего брата. Марк замечает твой взгляд и прячет руку. Теперь ты должен вернуть кольцо и найти брата.",
    [
      { id: "follow", label: "Тихо проследить за Марком", result: "Марк направляется к лифту с красной меткой.", clue: "Маршрут Марка", effects: { suspicion: 2 }, next: "chapter_end" },
      { id: "confront", label: "Потребовать вернуть кольцо", result: "Марк произносит: «Он сказал, что ты спросишь».", clue: "Кольцо брата", effects: { sanity: -4, suspicion: 8 }, next: "chapter_end" },
      { id: "record", label: "Записать разговор", result: "На записи слышны ещё два голоса, говорящих одновременно с Марком.", clue: "Два голоса Марка", effects: { distortion: 6 }, next: "chapter_end" }
    ]
  ),

  chapter_end: makeScene(
    "chapter_end", 3, "СЕКТОР B // ПЕРЕХОД",
    "Следующая дверь",
    "Ты остаёшься перед запертой дверью. За ней находится сектор, в котором исчез след Марка.",
    [
      { id: "continue", label: "Открыть следующий сектор", result: "Из темноты доносится голос Евы: «Теперь ты знаешь достаточно».", next: "chapter4" },
      { id: "archive", label: "Сохранить улики", result: "В архив добавлен документ ПРОТОКОЛ ТРЁХ.", clue: "Протокол трёх", next: "chapter4" },
      { id: "rest", label: "Перевести дыхание", result: "Ты восстанавливаешь силы.", effects: { health: 10, sanity: 5 }, next: "chapter4" }
    ]
  ),

  finalProtocol: makeScene(
    "finalProtocol", 12, "ЦЕНТРАЛЬНЫЙ ТЕРМИНАЛ // 03:17",
    "Последний протокол",
    "Перед тобой три протокола. Комплекс ждёт решения. Где-то за стеной кто-то повторяет твой вдох.",
    [
      { id: "evacuate", label: "Запустить эвакуацию", result: "Сирены включаются. Двери наружу начинают открываться.", ending: "evacuation" },
      { id: "contain", label: "Изолировать источник", result: "Терминал принимает биометрическое подтверждение.", ending: "watcher" },
      { id: "reset", label: "Перезапустить эксперимент", result: "Свет гаснет. Смена начинается снова.", ending: "quiet" }
    ]
  )
};

for (let chapter = 4; chapter <= 12; chapter++) {
  scenes[`chapter${chapter}`] = makeScene(
    `chapter${chapter}`,
    chapter,
    `СЕКТОР-9 // ГЛАВА ${String(chapter).padStart(2, "0")}`,
    CHAPTERS[chapter - 1].title,
    "Ты входишь в новый сектор. Записи говорят об экспериментах над памятью, а коридоры напоминают места, которых ты не помнишь. Смотритель где-то рядом. Каждый звук может выдать твоё присутствие.",
    [
      {
        id: "investigate",
        label: "Изучить следы эксперимента",
        result: "Ты находишь документы, связанные с предыдущими испытаниями.",
        clue: `Документы главы ${chapter}`,
        effects: { distortion: 3 },
        next: `chapter${chapter}b`
      },
      {
        id: "move",
        label: "Продвинуться в следующий сектор",
        result: "Ты проходишь через служебный коридор, но слышишь шаги за спиной.",
        effects: { suspicion: 5, battery: -3 },
        next: `chapter${chapter}b`
      },
      {
        id: "hide",
        label: "Выждать в укрытии",
        result: "Шаги удаляются. Ты используешь паузу, чтобы восстановить дыхание.",
        effects: { sanity: 2, suspicion: -3 },
        next: `chapter${chapter}b`
      }
    ]
  );

  scenes[`chapter${chapter}b`] = makeScene(
    `chapter${chapter}b`,
    chapter,
    `СЕКТОР-9 // КОНТРОЛЬНАЯ ТОЧКА ${chapter}`,
    "Выбор протокола",
    "Терминал предлагает три действия. Каждое решение оставляет след в системе. Ты не знаешь, кто прочитает эти записи.",
    [
      {
        id: "continue",
        label: chapter === 12 ? "Добраться до источника" : "Продолжить исследование",
        result: "Ты открываешь следующий сектор. Комплекс регистрирует твой проход.",
        next: chapter === 12 ? "finalProtocol" : `chapter${chapter + 1}`
      },
      {
        id: "search",
        label: "Собрать доказательства",
        result: "Ты копируешь записи из терминала и сохраняешь их в архиве.",
        clue: `Запись терминала ${chapter}`,
        effects: { distortion: 3 },
        next: chapter === 12 ? "finalProtocol" : `chapter${chapter + 1}`
      },
      {
        id: "recover",
        label: "Восстановить силы",
        result: "Ты находишь аптечку и запасные батареи.",
        effects: { health: 10, sanity: 5, battery: 10 },
        next: chapter === 12 ? "finalProtocol" : `chapter${chapter + 1}`
      }
    ]
  );
}

function getScene(save) {
  if (save.scene === "ending") return null;
  return scenes[save.scene] || scenes.intro;
}

function normalizeSave(save) {
  if (!save || typeof save !== "object") return makeInitialSave();

  const initial = makeInitialSave(save.difficulty);
  return {
    ...initial,
    ...save,
    stats: { ...initial.stats, ...(save.stats || {}) },
    inventory: Array.isArray(save.inventory) ? save.inventory.slice(0, 6) : initial.inventory,
    clues: Array.isArray(save.clues) ? save.clues : [],
    history: Array.isArray(save.history) ? save.history : [],
    flags: save.flags && typeof save.flags === "object" ? save.flags : {},
    unlockedChapters: Array.isArray(save.unlockedChapters) ? save.unlockedChapters : [1],
    completedChapters: Array.isArray(save.completedChapters) ? save.completedChapters : []
  };
}

async function getSaveOrCreate(userId) {
  let save = await loadSave(userId);

  if (!save) {
    save = makeInitialSave();
    await storeSave(userId, save);
  } else {
    save = normalizeSave(save);
  }

  return save;
}

function applyEffects(save, choice) {
  const effects = choice.effects || {};

  for (const [key, value] of Object.entries(effects)) {
    if (typeof save.stats[key] === "number") {
      save.stats[key] += Number(value) || 0;
    }
  }

  for (const key of ["health", "sanity", "battery", "suspicion", "distortion"]) {
    save.stats[key] = clamp(save.stats[key]);
  }

  save.stats.evaTrust = clamp(save.stats.evaTrust, -100, 100);

  if (choice.clue && !save.clues.includes(choice.clue)) {
    save.clues.push(choice.clue);
  }

  if (choice.item && !save.inventory.includes(choice.item) && save.inventory.length < 6) {
    save.inventory.push(choice.item);
  }

  save.history.push({
    chapter: save.chapter,
    scene: save.scene,
    choice: choice.label,
    result: choice.result,
    at: new Date().toISOString()
  });

  if (save.history.length > 500) {
    save.history = save.history.slice(-500);
  }
}

function getDeathRemaining(save) {
  if (!save.deathUntil) return 0;
  return Math.max(0, new Date(save.deathUntil).getTime() - Date.now());
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, game: "SECTOR-9: ЭХО" });
});

app.get("/api/session", requireTelegram, async (req, res) => {
  try {
    const save = await getSaveOrCreate(req.telegramUserId);

    res.json({
      save,
      scene: getScene(save),
      chapters: CHAPTERS,
      database: !!pool,
      deathRemaining: getDeathRemaining(save)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Не удалось загрузить сохранение." });
  }
});

app.post("/api/new-game", requireTelegram, async (req, res) => {
  try {
    const previous = await loadSave(req.telegramUserId);

    if (previous && getDeathRemaining(previous) > 0) {
      return res.status(423).json({
        error: "После гибели нужно подождать 10 минут.",
        deathRemaining: getDeathRemaining(previous)
      });
    }

    const difficulty = ["easy", "medium", "terror"].includes(req.body?.difficulty)
      ? req.body.difficulty
      : "medium";

    const save = makeInitialSave(difficulty);
    await storeSave(req.telegramUserId, save);

    res.json({
      save,
      scene: getScene(save),
      chapters: CHAPTERS,
      database: !!pool
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Не удалось создать игру." });
  }
});

app.get("/api/chapters", requireTelegram, async (req, res) => {
  try {
    const save = await getSaveOrCreate(req.telegramUserId);

    res.json({
      chapters: CHAPTERS.map(chapter => ({
        ...chapter,
        unlocked: save.unlockedChapters.includes(chapter.id),
        completed: save.completedChapters.includes(chapter.id)
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Не удалось загрузить главы." });
  }
});

app.post("/api/chapter", requireTelegram, async (req, res) => {
  try {
    const save = await getSaveOrCreate(req.telegramUserId);
    const chapter = Number(req.body?.chapter);

    if (!Number.isInteger(chapter) || chapter < 1 || chapter > 12) {
      return res.status(400).json({ error: "Некорректный номер главы." });
    }

    if (!save.unlockedChapters.includes(chapter)) {
      return res.status(403).json({ error: "Эта глава пока заблокирована." });
    }

    save.chapter = chapter;
    save.scene = chapter === 1 ? "intro" : chapter <= 3 ? ({
      2: "basement",
      3: "alone"
    })[chapter] : `chapter${chapter}`;

    save.ending = null;
    await storeSave(req.telegramUserId, save);

    res.json({ save, scene: getScene(save) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Не удалось открыть главу." });
  }
});

app.post("/api/choose", requireTelegram, async (req, res) => {
  try {
    const save = await getSaveOrCreate(req.telegramUserId);

    if (getDeathRemaining(save) > 0) {
      return res.status(423).json({
        error: "Смена завершена. Новая попытка будет доступна после ожидания.",
        deathRemaining: getDeathRemaining(save)
      });
    }

    const scene = getScene(save);
    const choice = scene?.choices?.find(c => c.id === req.body?.choiceId);

    if (!choice) {
      return res.status(400).json({ error: "Такого действия нет в текущей сцене." });
    }

    applyEffects(save, choice);
    save.lastResult = choice.result || "";

    if (choice.ending) {
      let endingId = choice.ending;

      if (save.stats.distortion >= 30 && save.clues.length >= 4) {
        endingId = "zero";
      }

      if (save.stats.distortion >= 45 && save.clues.length >= 6 && save.stats.evaTrust <= 0) {
        endingId = "break";
      }

      const ending = endings[endingId] || endings.evacuation;

      save.ending = { id: endingId, ...ending };
      save.scene = "ending";
      save.completedChapters = [...new Set([...save.completedChapters, 12])];
      await storeSave(req.telegramUserId, save);

      return res.json({
        save,
        scene: null,
        ending: save.ending,
        result: save.lastResult
      });
    }

    const nextScene = scenes[choice.next];

    if (!nextScene) {
      return res.status(500).json({ error: "Следующая сцена не найдена." });
    }

    const currentChapter = scene.chapter || save.chapter;
    const nextChapter = nextScene.chapter || currentChapter;

    if (nextChapter > currentChapter) {
      save.completedChapters = [...new Set([...save.completedChapters, currentChapter])];

      if (nextChapter <= 12 && !save.unlockedChapters.includes(nextChapter)) {
        save.unlockedChapters.push(nextChapter);
      }

      save.chapter = nextChapter;
    }

    save.scene = choice.next;

    if (save.stats.health <= 0 || save.stats.sanity <= 0) {
      save.deathUntil = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      save.scene = "ending";
      save.ending = {
        id: "death",
        title: "СМЕНА ЗАВЕРШЕНА",
        text: "Ты больше не можешь продолжать. Сектор-9 поглощает последние воспоминания. Новая попытка будет доступна через 10 минут."
      };
    }

    await storeSave(req.telegramUserId, save);

    res.json({
      save,
      scene: getScene(save),
      ending: save.ending || null,
      result: save.lastResult,
      chapters: CHAPTERS,
      deathRemaining: getDeathRemaining(save)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Не удалось сохранить действие." });
  }
});

if (BOT_TOKEN) {
  const bot = new TelegramBot(BOT_TOKEN, { polling: true });

  bot.onText(/\/start/, async msg => {
    const keyboard = APP_URL
      ? {
          inline_keyboard: [[
            {
              text: "☠️ ОТКРЫТЬ SECTOR-9: ЭХО",
              web_app: { url: APP_URL }
            }
          ]]
        }
      : {
          inline_keyboard: [[
            {
              text: "Сначала настрой APP_URL",
              callback_data: "missing_url"
            }
          ]]
        };

    await bot.sendMessage(
      msg.chat.id,
      "⛧ SECTOR-9: ЭХО ⛧\n\nСектор закрыт 17 лет назад. Сегодня ночью он снова вышел на связь.\n\nНе доверяй голосу из радио.\nНе верь камерам.\nИ если услышишь собственный голос — не отвечай.",
      { reply_markup: keyboard }
    );
  });

  bot.on("polling_error", err => {
    console.error("Telegram polling error:", err.message);
  });

  console.log("Telegram bot polling enabled.");
} else {
  console.warn("BOT_TOKEN is missing. Telegram bot is disabled.");
}

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`SECTOR-9: ЭХО listening on ${PORT}`);
    });
  })
  .catch(err => {
    console.error("Database initialization failed:", err);
    process.exit(1);
  });

(() => {
  const tg = window.Telegram?.WebApp;
  if (tg) { tg.ready(); tg.expand(); try { tg.setHeaderColor("#08090b"); tg.setBackgroundColor("#08090b"); } catch {} }
  const $ = id => document.getElementById(id);
  const screens = ["home","difficulty","game","ending","archive","pause"];
  let save = null, scene = null, pendingResult = "", selectedDifficulty = "medium", lastScreen = "game";
  const difficultyNames = { easy:"ЛЁГКИЙ", medium:"СРЕДНИЙ", terror:"УЖАСАЮЩИЙ" };
  const initData = tg?.initData || "";
  const demoMode = !initData;

  function show(id) {
    screens.forEach(s => $(s).classList.toggle("hidden", s !== id));
    if (id !== "game") lastScreen = id;
  }
  function toast(message) {
    $("toast").textContent = message; $("toast").classList.remove("hidden");
    setTimeout(() => $("toast").classList.add("hidden"), 3300);
  }
  async function api(path, body) {
    const res = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type":"application/json", "X-Telegram-Init-Data":initData },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Ошибка соединения.");
    return data;
  }
  function demoSave(difficulty="medium") {
    return { difficulty, chapter:1, scene:"intro", stats:{health:100,sanity:100,battery:82,suspicion:8,distortion:0,evaTrust:0}, inventory:["Фонарик","Диктофон"], clues:[], history:[] };
  }
  async function loadGame() {
    try {
      const data = demoMode ? null : await api("/api/session");
      if (data) { save = data.save; scene = data.scene; }
      else { save = demoSave(); scene = demoScenes.intro; }
      renderGame(); show("game");
    } catch (e) {
      toast(e.message + " Для локального теста можно открыть сайт напрямую, но сохранение будет демонстрационным.");
    }
  }
  async function newGame() {
    if (save && !confirm("Начать новую смену? Текущее сохранение будет заменено.")) return;
    try {
      const data = demoMode ? null : await api("/api/new-game", { difficulty:selectedDifficulty });
      if (data) { save = data.save; scene = data.scene; }
      else { save = demoSave(selectedDifficulty); scene = demoScenes.intro; }
      pendingResult = ""; renderGame(); show("game");
      if (demoMode) toast("Демонстрационный режим: открой Mini App через Telegram, чтобы включить серверные сохранения.");
    } catch (e) { toast(e.message); }
  }
  function updateBar(name, value) {
    $(name).textContent = Math.max(0,Math.min(100,value));
    $(name+"Bar").style.width = Math.max(0,Math.min(100,value)) + "%";
  }
  function renderGame() {
    $("location").textContent = scene?.location || "СЕКТОР-9";
    $("sceneTitle").textContent = scene?.title || "Сигнал потерян";
    $("storyText").textContent = scene?.text || "Сигнал потерян.";
    $("resultText").textContent = pendingResult;
    $("resultText").classList.toggle("hidden", !pendingResult);
    $("difficultyLabel").textContent = difficultyNames[save.difficulty] || "СРЕДНИЙ";
    updateBar("health",save.stats.health); updateBar("sanity",save.stats.sanity);
    updateBar("battery",save.stats.battery); updateBar("suspicion",save.stats.suspicion);
    $("inventoryCount").textContent = `${save.inventory.length}/6`;
    $("clueCount").textContent = save.clues.length;
    renderChips("inventory",save.inventory,"Инвентарь пуст");
    renderChips("clues",save.clues,"Улик пока нет");
    const choices = $("choices"); choices.innerHTML = "";
    (scene?.choices || []).forEach((choice,index) => {
      const button = document.createElement("button"); button.className = "choice";
      const num = document.createElement("span"); num.className = "num"; num.textContent = `0${index+1}`;
      const label = document.createElement("span"); label.textContent = choice.label;
      button.append(num,label); button.addEventListener("click",()=>choose(choice.id)); choices.append(button);
    });
    $("saveStatus").textContent = demoMode ? "DEMO" : "●";
  }
  function renderChips(id,items,empty) {
    const box = $(id); box.innerHTML = "";
    if (!items?.length) { const el=document.createElement("span");el.className="chip empty";el.textContent=empty;box.append(el);return; }
    items.forEach(item=>{const el=document.createElement("span");el.className="chip";el.textContent=item;box.append(el);});
  }
  async function choose(choiceId) {
    document.querySelectorAll(".choice").forEach(b=>b.disabled=true);
    try {
      if (demoMode) {
        const choice = scene.choices.find(c=>c.id===choiceId);
        if (!choice) return;
        applyDemoChoice(choice);
      } else {
        const data = await api("/api/choose",{choiceId});
        save = data.save; scene = data.scene; pendingResult = data.result || "";
        if (data.ending) { $("endingTitle").textContent=data.ending.title; $("endingText").textContent=data.ending.text; show("ending"); }
        else renderGame();
      }
    } catch (e) { toast(e.message); }
    finally { document.querySelectorAll(".choice").forEach(b=>b.disabled=false); }
  }
  function applyDemoChoice(choice) {
    for (const [key,val] of Object.entries(choice.effects||{})) if (typeof save.stats[key]==="number") save.stats[key]=Math.max(0,Math.min(100,save.stats[key]+val));
    if (choice.addClue && !save.clues.includes(choice.addClue)) save.clues.push(choice.addClue);
    if (choice.addItem && save.inventory.length<6 && !save.inventory.includes(choice.addItem)) save.inventory.push(choice.addItem);
    pendingResult = choice.result;
    save.history.push({scene:save.scene,choice:choice.label});
    save.scene = choice.next || "hall";
    scene = demoScenes[save.scene] || demoScenes.hall;
    if (choice.ending) { $("endingTitle").textContent="СИГНАЛ ЗАВЕРШЁН"; $("endingText").textContent=choice.result; show("ending"); }
    else renderGame();
  }
  const demoScenes = {
    intro: {location:"ОПЕРАТОРСКАЯ // 00:41",title:"Последняя смена",text:"Вентиляция гудит за стеной. На трёх мониторах — пустые коридоры. По документам Сектор-9 закрыт семнадцать лет назад, но на столе лежит свежий пропуск с твоим именем. Радиоприёмник щёлкает сам по себе.",choices:[
      {id:"radio",label:"Проверить радиоприёмник",result:"Сквозь шипение пробивается твой собственный голос: «Оператор, не выходи в коридор».",effects:{sanity:-4,suspicion:4},next:"hall"},
      {id:"monitor",label:"Осмотреть камеры наблюдения",result:"На последней камере в конце коридора стоит высокая фигура.",effects:{battery:-3,suspicion:6},next:"hall"},
      {id:"badge",label:"Изучить пропуск на столе",result:"На пропуске твоё имя. Дата выдачи — семнадцать лет назад.",effects:{distortion:3},addClue:"Пропуск Оператора-0",next:"hall"}
    ]},
    hall:{location:"СЕКТОР A // КОРИДОР",title:"За дверью",text:"Коридор освещён одной красной лампой. Впереди — развилка к жилому блоку, медицинскому сектору и архиву. Из динамика раздаётся тихий вдох.",choices:[
      {id:"residential",label:"Направиться в жилой блок",result:"На двери комнаты выцарапано число 38.",effects:{battery:-4},next:"residential"},
      {id:"medical",label:"Проверить медицинский сектор",result:"За стеклом виден силуэт в белом халате.",effects:{sanity:-2,suspicion:5},next:"medical"},
      {id:"archive",label:"Попробовать открыть архив",result:"Считыватель мигает красным. Для доступа нужен пропуск старшего персонала.",effects:{suspicion:3},next:"archive"}
    ]},
    residential:{location:"ГЛАВА 2 // ЖИЛОЙ БЛОК",title:"Комната 38",text:"На стене висит фотография команды Сектора-9. Одно лицо вырезано. На столе стоит чашка с ещё тёплым чаем.",choices:[
      {id:"photo",label:"Изучить фотографию",result:"На обороте написано: «Мы не пропали. Нас повторили».",effects:{distortion:4},addClue:"Фотография команды",next:"hall"},
      {id:"cup",label:"Проверить чашку",result:"На дне чашки лежит маленький ключ с номером 09.",effects:{sanity:-2},addItem:"Ключ 09",next:"hall"},
      {id:"closet",label:"Открыть шкаф",result:"Внутри висит твоя рабочая куртка. В кармане записка о Еве.",effects:{suspicion:4},addClue:"Записка о Еве",next:"hall"}
    ]},
    medical:{location:"МЕДИЦИНСКИЙ СЕКТОР",title:"Чужая карта",text:"Одна медицинская карта подписана твоим именем, а дата поступления стоит семнадцать лет назад.",choices:[
      {id:"glass",label:"Осмотреть карту через стекло",result:"В графе «статус» написано: реконструкция памяти.",effects:{sanity:-5,distortion:4},addClue:"Медицинская карта",next:"hall"},
      {id:"panel",label:"Проверить панель доступа",result:"«Доступ разрешён только сотруднику, который уже вошёл».",effects:{suspicion:4},next:"hall"},
      {id:"call",label:"Вызвать дежурного по связи",result:"Ева шепчет: «Не открывай кабинет. Там не ты».",effects:{sanity:-2},next:"hall"}
    ]},
    archive:{location:"АРХИВ // УРОВЕНЬ ДОСТУПА 2",title:"Дверь не забывает",text:"Терминал показывает время последнего входа: 03:17. Время следующего входа — тоже 03:17.",choices:[
      {id:"terminal",label:"Попытаться войти как Оператор-0",result:"Терминал просит подтвердить последствия повторного доступа.",effects:{distortion:3},next:"hall"},
      {id:"search",label:"Искать журнал доступа",result:"В журнале десятки входов с твоим идентификатором.",effects:{sanity:-4},addClue:"Журнал доступа",next:"hall"},
      {id:"retreat",label:"Отойти от двери",result:"За дверью кто-то тихо говорит: «Спасибо».",effects:{suspicion:-2},next:"hall"}
    ]}
  };
  function renderArchive() {
    const box=$("archiveList");box.innerHTML="";
    const clues=save?.clues||[];
    if(!clues.length){box.innerHTML='<div class="archive-item">АРХИВ ПУСТ<small>Исследуй комплекс, чтобы находить доказательства.</small></div>';return;}
    clues.forEach((clue,i)=>{const el=document.createElement("div");el.className="archive-item";el.textContent=`EVIDENCE-${String(i+1).padStart(3,"0")} // ${clue}`;const small=document.createElement("small");small.textContent="Материал зарегистрирован в архиве оператора.";el.append(small);box.append(el);});
  }
  $("newBtn").addEventListener("click",()=>show("difficulty"));
  $("continueBtn").addEventListener("click",loadGame);
  $("archiveBtn").addEventListener("click",()=>{renderArchive();show("archive")});
  $("endingArchiveBtn").addEventListener("click",()=>{renderArchive();show("archive")});
  $("startGameBtn").addEventListener("click",newGame);
  $("restartBtn").addEventListener("click",()=>show("difficulty"));
  $("menuBtn").addEventListener("click",()=>show("pause"));
  $("resumeBtn").addEventListener("click",()=>{show("game");renderGame()});
  $("pauseArchiveBtn").addEventListener("click",()=>{renderArchive();show("archive")});
  $("mainMenuBtn").addEventListener("click",()=>show("home"));
  document.querySelectorAll("[data-screen]").forEach(b=>b.addEventListener("click",()=>show(b.dataset.screen)));
  document.querySelectorAll("[data-difficulty]").forEach(b=>b.addEventListener("click",()=>{
    selectedDifficulty=b.dataset.difficulty;
    document.querySelectorAll("[data-difficulty]").forEach(x=>x.classList.toggle("selected",x===b));
  }));
  $("clock").textContent="03:17";
  if(!demoMode) {
    api("/api/session").then(data=>{save=data.save;scene=data.scene;$("continueBtn").classList.remove("hidden")}).catch(()=>{});
  } else {
    $("continueBtn").classList.remove("hidden");
  }
})();

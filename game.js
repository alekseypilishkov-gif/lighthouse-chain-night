/* Lighthouse / standalone combat prototype. No dependencies or external services. */
(function () {
  "use strict";

  var W = 960, H = 720, CX = 480, CY = 360, TOWER = 40, TAU = Math.PI * 2;
  var canvas = document.getElementById("sea");
  var ctx = canvas.getContext("2d");
  var overlay = document.getElementById("overlay");
  var stage = document.getElementById("stage");
  var $ = function (id) { return document.getElementById(id); };
  var config = {radius:52, duration:1.25, reload:2.1, radii:false};
  var s, lastFrame = 0, uiTimer = 0, toastTimeout = 0;
  var COLORS = {ordinary:"#a6c7c2", runner:"#b8aed3", conductor:"#d5b675"};
  var MODULES = {
    none:{name:"Базовая оптика", info:"Один световой импульс. Погибшие существа передают свет дальше."},
    capacitor:{name:"Дополнительный накопитель", info:"Заряды восстанавливаются по одному с обычной скоростью."},
    delayed:{name:"Отложенная вспышка", info:"Помеченное существо несёт свет в движении и вспыхивает позднее."},
    bridge:{name:"Переход через разрыв", info:"После затухания цепь может перескочить к следующей цели."}
  };

  function clamp(x, low, high) { return Math.min(high, Math.max(low, x)); }
  function dist(x,y,u,v) { return Math.hypot(x-u,y-v); }
  function easeOut(t) { return 1 - Math.pow(1-clamp(t,0,1),3); }
  function roman(n) { return n===2?"II":"I"; }
  function number(x, digits) { return x.toFixed(digits).replace(".",","); }
  function seedRand() { s.seed = (s.seed * 1664525 + 1013904223) >>> 0; return s.seed / 4294967296; }
  function randomBetween(a,b) { return a + (b-a)*seedRand(); }
  function escapeHtml(v) { return String(v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); }

  function makeState(mode) {
    return {
      mode:mode||"campaign", phase:"intro", over:"intro", wave:0, health:100, time:0,
      wavesPassed:0, enemies:[], bursts:[], beams:[], rings:[], sparks:[], floaters:[],
      chains:{}, chainCounter:0, nextEnemyId:1, kills:0, shots:0, breaks:0, bestChain:0, seed:374829,
      gunAngle:-Math.PI/2, pending:null, pointer:{x:CX,y:CY-180}, charges:1, recharge:0,
      module:"none", level:0, shotMode:"normal", marks:[], spawnPlan:[], spawnCursor:0, waveTime:0,
      pulse:0, shake:0, lastWaveDone:false, lastRecordedChain:0, testTime:0
    };
  }
  s = makeState("campaign");

  function maxCharges() {
    if (s.module==="capacitor") return s.level>=2?3:2;
    return 1;
  }
  function bridgeCount() {
    return s.module==="bridge" ? (s.level>=2 ? 2 : 1) : 0;
  }
  function maxMarks() {
    return s.module==="delayed" ? (s.level>=2?2:1) : 0;
  }
  function createChain() {
    var id = ++s.chainCounter;
    s.chains[id] = {id:id,kills:0,bridges:bridgeCount(),lastX:CX,lastY:CY,closed:false};
    return id;
  }

  function enemy(x,y,type,speed) {
    var px = Math.round(x),py = Math.round(y);
    return {
      id:s.nextEnemyId++,x:px,y:py,type:type||"ordinary",
      baseSpeed:speed || 36, health:1,dead:false, wobble:randomBetween(0,TAU),
      wobblePower:randomBetween(1.8,4.3), mark:false,
      radius:type==="conductor"?11:(type==="runner"?7:9)
    };
  }
  function addEnemy(x,y,type,speed) { s.enemies.push(enemy(x,y,type,speed)); }

  function buildWave(index) {
    var schedule=[], groups=[4,5,6,7,8][index-1], size=[5,5,6,6,7][index-1];
    var angleShift=.17*index;
    for(var group=0;group<groups;group++){
      var angle=(group/groups)*TAU - Math.PI/2 + angleShift + randomBetween(-.12,.12);
      for(var j=0;j<size;j++){
        var a=angle+(j-(size-1)/2)*randomBetween(.046,.070);
        var r1=460+randomBetween(-12,12);
        var r2=340+randomBetween(-12,12);
        var type="ordinary";
        if(index>1 && (group+j)%8===2) type="runner";
        if((group*size+j+index)%11===0) type="conductor";
        var speed=(32+index*4.5)*(type==="runner"?1.65:(type==="conductor"?.78:1));
        schedule.push({t:group*(index<=2?4.8:3.7)+j*.22,
          x:CX+Math.cos(a)*r1,y:CY+Math.sin(a)*r2,type:type,speed:speed});
      }
    }
    schedule.sort(function(a,b){return a.t-b.t;});
    return schedule;
  }

  function spawnTest() {
    /* Identical starting positions on every retry; separated flocks with moving runner links. */
    var formations=[
      {x:-275,y:-163,t:"ordinary"},{x:-248,y:-178,t:"ordinary"},{x:-222,y:-154,t:"ordinary"},
      {x:-266,y:-129,t:"ordinary"},{x:-236,y:-118,t:"conductor"},
      {x:-146,y:-232,t:"runner"},{x:-116,y:-240,t:"ordinary"},{x:-90,y:-266,t:"ordinary"},
      {x:-78,y:-225,t:"ordinary"},{x:-63,y:-192,t:"conductor"},
      {x:10,y:-280,t:"ordinary"},{x:37,y:-300,t:"ordinary"},{x:65,y:-275,t:"ordinary"},
      {x:82,y:-243,t:"runner"},{x:109,y:-255,t:"ordinary"},
      {x:250,y:108,t:"ordinary"},{x:272,y:137,t:"ordinary"},{x:220,y:139,t:"conductor"},
      {x:265,y:170,t:"runner"}
    ];
    formations.forEach(function(p){
      addEnemy(CX+p.x,CY+p.y,p.t,p.t==="runner"?54:(p.t==="conductor"?22:29));
    });
  }

  function start(mode) {
    var selectedModule = $("testModule").value;
    var selectedLevel = parseInt($("testLevel").value,10);
    s = makeState(mode);
    s.phase="battle";s.over="";
    if(mode==="test"){
      s.module=selectedModule;
      s.level=selectedModule==="none"?0:selectedLevel;
      s.charges=maxCharges();
      spawnTest();
      $("topStatus").textContent="ИСПЫТАТЕЛЬНАЯ АКВАТОРИЯ";
      $("battleTag").textContent="ОПЫТ · ОДИНАКОВАЯ РАССТАНОВКА";
    }else{
      $("topStatus").textContent="НОЧНАЯ ВАХТА · ПЯТЬ ВОЛН";
      $("battleTag").textContent="360° · НОЧНАЯ ВАХТА";
      startWave(1);
    }
    hideOverlay();updateUI();toast(mode==="test"?"Испытание: попробуй запускать длинные цепи.":"Существа идут к Маяку со всех сторон.");
  }
  function startWave(n){
    s.phase="battle";s.over="";s.wave=n;s.waveTime=0;s.spawnCursor=0;
    s.spawnPlan=buildWave(n);s.lastWaveDone=false;
    s.enemies=[];s.bursts=[];s.beams=[];s.rings=[];s.sparks=[];s.floaters=[];s.chains={};
    s.marks=[];s.pending=null;
    s.charges=maxCharges();s.recharge=0;
    hideOverlay(); updateUI();
  }

  function moduleCard(key, level) {
    var name=MODULES[key].name;
    var details={
      capacitor:["Два заряда в запасе. Восстанавливаются по одному с обычной скоростью.","Три заряда в запасе. Быстрая защита нескольких направлений."],
      delayed:["Дополнительный выстрел заряжает одну цель. Через 1,6 с она вспыхивает с увеличенным на 35% радиусом.","Две активные метки. Задержка 3,6 с и ручной подрыв клавишей E."],
      bridge:["После обычного затухания цепь один раз передаёт свет на расстояние до 2,2 радиуса вспышки.","Два перехода через разрывы в каждой цепи."]
    };
    var icon={capacitor:"▯ ▯",delayed:"◷",bridge:"↝"}[key];
    return '<button type="button" class="module-card" data-action="selectModule" data-module="'+key+'">' +
      '<span class="card-level">УРОВЕНЬ '+roman(level)+'</span><div class="card-icon">'+icon+'</div>'+
      '<h3>'+name+'</h3><p>'+details[key][level-1]+'</p>'+
      '<div class="card-action"><span>УСТАНОВИТЬ МОДУЛЬ</span><span>→</span></div></button>';
  }

  function showOverlay(type, back) {
    s.over=type;s.phase=type==="intro"?"intro":s.phase;
    overlay.className="overlay is-open"+(type==="intro"?" intro":"");
    var body="";
    if(type==="intro"){
      body='<div class="overline">ЭКСПЕРИМЕНТ СО СВЕТОМ</div>'+
        '<h1>Зажги цепную <em>реакцию.</em></h1>'+
        '<p>Существа окружают Маяк. Один точный импульс превращает стаю в цепь вспышек. Выбирай начало реакции, используй усиления линзы и следи за другой стороной.</p>'+
        '<div class="intro-list"><div><b>01</b> Выбери цель и выпусти свет.</div><div><b>02</b> Вспышки погибших поражают соседей.</div><div><b>03</b> После первой и третьей волн усиливай пушку.</div></div>'+
        '<div class="button-row"><button class="accent-btn" data-action="campaign">Начать оборону</button><button class="soft-btn" data-action="test">Сначала испытать модули</button></div>'+
        '<div class="subnote">5 ВОЛН · ТРИ МОДУЛЯ · ОДНА СВЕТОВАЯ ПУШКА · ВИД СВЕРХУ</div>';
    }else if(type==="pause"){
      body='<div class="overline">ВАХТА ПРИОСТАНОВЛЕНА</div><h2>Свет подождёт.</h2>'+
        '<p>Море замерло. Можно осмотреть поле, изучить параметры реакции или продолжить ночь.</p>'+
        '<div class="button-row"><button class="accent-btn" data-action="resume">Продолжить</button><button class="soft-btn" data-action="restart">Начать заново</button></div>';
    }else if(type==="workshop"){
      var lvl=s.wave===1?1:2;
      var cards=lvl===1?
        moduleCard("capacitor",1)+moduleCard("delayed",1)+moduleCard("bridge",1):
        moduleCard(s.module,2);
      body='<div class="overline">МАСТЕРСКАЯ · ПОСЛЕ '+(s.wave===1?"ПЕРВОЙ":"ТРЕТЬЕЙ")+' ВОЛНЫ</div>'+
        '<h2>Измени правила света.</h2>'+
        '<p>'+(lvl===1?"Выбери модуль пушки. Каждый даёт свой способ управлять боем.":
          "Усиль установленный модуль. Новые возможности будут доступны в следующей волне.")+'</p>'+
        '<div class="module-cards">'+cards+'</div>'+
        '<div class="tip">Море на паузе. Выбор сохраняется до конца обороны. Установить модуль можно клавишей 1'+(lvl===1?', 2 или 3':'')+'.</div>';
    }else if(type==="clear"){
      body='<div class="overline">СЕКТОР ЧИСТ</div><h2>Волна отражена.</h2>'+
        '<p>Маяк устоял. Но давление извне растёт. Проверь готовность пушки, прежде чем продолжать.</p>'+
        '<div class="result-grid"><div><small>ВОЛНА</small><strong>'+String(s.wave).padStart(2,"0")+' / 05</strong></div><div><small>ЦЕЛОСТНОСТЬ</small><strong>'+Math.ceil(s.health)+'%</strong></div><div><small>ЛУЧШАЯ ЦЕПЬ</small><strong>×'+s.bestChain+'</strong></div></div>'+
        '<div class="button-row"><button class="accent-btn" data-action="next">Следующая волна</button><button class="soft-btn" data-action="restart">Начать заново</button></div>';
    }else if(type==="victory"||type==="defeat"||type==="testclear"){
      var success=type!=="defeat";
      body='<div class="overline">'+(type==="testclear"?"ИСПЫТАНИЕ ЗАВЕРШЕНО":(success?"КОНЕЦ ВАХТЫ · МАЯК ВЫСТОЯЛ":"КОНЕЦ ВАХТЫ · МАЯК ПОГАС"))+'</div>'+
        '<h2>'+(type==="testclear"?"Свет нашёл дорогу.":(success?"Маяк ещё горит.":"Маяк погас."))+'</h2>'+
        '<p>'+(type==="testclear"?"Повтори ту же расстановку с другим модулем и сравни результаты.":"Это экспериментальная модель обороны. Попробуй другой модуль и найди более выгодное начало цепей.")+'</p>'+
        '<div class="result-grid"><div><small>ПОВЕРЖЕНО</small><strong>'+s.kills+'</strong></div><div><small>ЛУЧШАЯ ЦЕПЬ</small><strong>×'+s.bestChain+'</strong></div><div><small>ИМПУЛЬСОВ</small><strong>'+s.shots+'</strong></div></div>'+
        '<div class="button-row"><button class="accent-btn" data-action="'+(s.mode==="test"?"test":"restart")+'">'+(s.mode==="test"?"Повторить опыт":"Ещё одна ночь")+'</button>'+
        '<button class="soft-btn" data-action="test">Проверить другую настройку</button><button class="soft-btn" data-action="copy">Скопировать результат</button></div>'+
        '<div class="subnote">МОДУЛЬ: '+escapeHtml(MODULES[s.module].name)+(s.level?' · УРОВЕНЬ '+roman(s.level):'')+' · ПРОРЫВОВ: '+s.breaks+'</div>';
    }else if(type==="help"){
      body='<div class="overline">ПАМЯТКА СМОТРИТЕЛЮ</div><h2>Выбирай начало цепи.</h2>'+
      '<p>Нажми ЛКМ или пробел, чтобы отправить световой импульс. Пушка сперва поворачивается к цели. Погибшее существо вспыхивает — соседние погибают и передают свет дальше. Золотой проводник увеличивает радиус следующей вспышки.</p>'+
      '<p><b>Накопитель</b> позволяет стрелять несколькими зарядами. <b>Отложенная вспышка</b> помечает цель (ПКМ или Q), пока она продолжает двигаться; на уровне II можно подорвать метки клавишей E. <b>Переход через разрыв</b> соединяет соседние стаи после затухания обычной цепи.</p>'+
      '<p>Существа подходят с разных сторон. Если враг добирается до основания, Маяк теряет прочность. Переживи пять волн. В испытательной акватории расстановка повторяется.</p>'+
      '<div class="button-row"><button class="accent-btn" data-action="closeHelp">Понятно</button></div>';
    }
    overlay.innerHTML='<div class="inner">'+body+'</div>';
    overlay.dataset.previous=back||"";
  }
  function hideOverlay() { s.over="";overlay.className="overlay";overlay.innerHTML=""; }
  function toast(msg) {
    var node=$("toast"); node.textContent=msg;node.classList.add("show");
    clearTimeout(toastTimeout);toastTimeout=setTimeout(function(){node.classList.remove("show");},2200);
  }
  function setPhase(type) {
    s.phase=type;
    if(type==="workshop") showOverlay("workshop");
    else if(type==="clear") showOverlay("clear");
    else if(type==="defeat") showOverlay("defeat");
    else if(type==="victory") showOverlay("victory");
    else if(type==="testclear") showOverlay("testclear");
    else if(type==="pause") showOverlay("pause");
    updateUI();
  }

  function finishWave(){
    if(s.phase!=="battle") return;
    if(s.mode==="test"){setPhase("testclear");return;}
    s.wavesPassed=s.wave;
    if(s.wave===5){setPhase("victory");return;}
    setPhase(s.wave===1||s.wave===3?"workshop":"clear");
  }
  function chooseModule(module){
    if(s.phase!=="workshop") return;
    if(s.wave===1 && MODULES[module] && module!=="none"){
      s.module=module;s.level=1;
    }else if(s.wave===3 && module===s.module){
      s.level=2;
    }else return;
    s.charges=maxCharges();s.recharge=0;s.shotMode="normal";s.marks=[];
    startWave(s.wave+1);
    toast(MODULES[s.module].name+" · уровень "+roman(s.level));
  }
  function pauseOrResume(){
    if(s.phase==="battle"){setPhase("pause");return;}
    if(s.phase==="pause"){s.phase="battle";hideOverlay();updateUI();}
  }

  function pointerPosition(e){
    var rect=canvas.getBoundingClientRect();
    var x=(e.clientX-rect.left)/rect.width*W, y=(e.clientY-rect.top)/rect.height*H;
    return {x:clamp(x,0,W),y:clamp(y,0,H)};
  }
  function setPointer(p){s.pointer=p;}
  function nearEnemy(x,y,r){
    var chosen=null, best=r;
    s.enemies.forEach(function(en){if(en.dead)return;var d=dist(x,y,en.x,en.y);if(d<best){chosen=en;best=d;}});
    return chosen;
  }
  function requestFire(p, forceMark){
    if(s.phase!=="battle")return;
    setPointer(p);
    if(s.pending){toast("Орудие ещё поворачивается.");return;}
    if(s.charges<1){toast("Идёт перезарядка.");return;}
    var mark=s.module==="delayed" && (forceMark||s.shotMode==="mark");
    var target=null;
    if(mark){
      target=nearEnemy(p.x,p.y,34);
      if(!target){toast("Для метки наведи свет на существо.");return;}
      if(s.marks.length>=maxMarks()){toast("Лимит активных меток.");return;}
      if(target.mark){toast("Это существо уже отмечено.");return;}
    }
    s.pending={x:mark?target.x:p.x,y:mark?target.y:p.y,mark:mark,targetId:target?target.id:null};
    /* Charges are spent only after the turret has finished its turn. */
  }
  function spendCharge(){
    s.charges=Math.max(0,s.charges-1);
    s.shots++;
    if(s.charges<maxCharges() && s.recharge===0)s.recharge=.001;
  }
  function shotFx(x,y,mark){
    s.beams.push({x1:CX,y1:CY,x2:x,y2:y,time:0,life:.25,mark:!!mark,bridge:false});
    s.rings.push({x:x,y:y,r:mark?16:29,t:0,life:.48,color:mark?"#aea0da":"#f4deae"});
    s.pulse=.22;
  }
  function fireNow(o){
    spendCharge();
    var x=o.x,y=o.y;
    if(o.mark){
      var target=s.enemies.find(function(e){return e.id===o.targetId&&!e.dead;});
      if(!target){toast("Цель исчезла до попадания.");return;}
      x=target.x;y=target.y;
      if(target.mark){toast("Цель уже помечена.");return;}
      var timer=s.level===2?3.6:1.6;
      target.mark=true;
      s.marks.push({id:target.id,time:timer,initial:timer});
      shotFx(x,y,true);s.floaters.push({x:x,y:y-17,text:"МЕТКА",time:0,life:.85,color:"#c5b7e6"});
      return;
    }
    shotFx(x,y,false);
    var hit=s.enemies.filter(function(e){return !e.dead && dist(x,y,e.x,e.y)<=29;});
    if(hit.length){
      var id=createChain();
      hit.forEach(function(e){kill(e,id);});
    }else{
      s.floaters.push({x:x,y:y-10,text:"МИМО",time:0,life:.8,color:"#b2aa91"});
    }
  }
  function detonateMarks(){
    if(s.module!=="delayed"||s.level<2||s.phase!=="battle")return;
    if(!s.marks.length){toast("Нет активных меток.");return;}
    s.marks.slice().forEach(function(mark){detonate(mark.id);});
  }
  function detonate(id){
    var target=s.enemies.find(function(en){return en.id===id && !en.dead;});
    s.marks=s.marks.filter(function(m){return m.id!==id;});
    if(!target)return;
    target.mark=false;
    var chainId=createChain();
    s.rings.push({x:target.x,y:target.y,r:config.radius*1.35,t:0,life:.55,color:"#d3bee9"});
    kill(target,chainId,1.35);
    s.floaters.push({x:target.x,y:target.y-20,text:"РАЗРЯД",time:0,life:1,color:"#c5b7e6"});
  }
  function kill(en,chainId,amp){
    if(en.dead)return;
    en.dead=true;en.mark=false;
    s.marks=s.marks.filter(function(m){return m.id!==en.id;});
    s.kills++;
    var chain=s.chains[chainId];
    if(chain){
      chain.kills++;chain.lastX=en.x;chain.lastY=en.y;
      if(chain.kills>s.bestChain){s.bestChain=chain.kills;s.lastRecordedChain=chain.kills;}
    }
    var mult=(en.type==="conductor"?1.4:(en.type==="runner"?.72:1))*(amp||1);
    s.bursts.push({x:en.x,y:en.y,base:config.radius*mult,time:0,life:config.duration,
      chainId:chainId,hit:{},maxRadius:config.radius*mult});
    for(var i=0;i<6;i++){
      var a=seedRand()*TAU,v=30+seedRand()*70;
      s.sparks.push({x:en.x,y:en.y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,t:0,life:.36+seedRand()*.45,
        c:COLORS[en.type]});
    }
    s.floaters.push({x:en.x,y:en.y-12,text:"+"+10,color:en.type==="conductor"?"#e8c783":"#bdd6d0",time:0,life:.65});
  }
  function tryBridge(chain){
    if(!chain||chain.bridges<=0)return;
    var nearest=null, nearestD=config.radius*2.2;
    s.enemies.forEach(function(en){
      if(en.dead)return;
      var d=dist(chain.lastX,chain.lastY,en.x,en.y);
      if(d>config.radius*.92 && d<nearestD){nearest=en;nearestD=d;}
    });
    if(nearest){
      var ox=chain.lastX,oy=chain.lastY;
      chain.bridges--;
      s.beams.push({x1:ox,y1:oy,x2:nearest.x,y2:nearest.y,time:0,life:.42,bridge:true});
      s.rings.push({x:nearest.x,y:nearest.y,r:config.radius*.6,t:0,life:.48,color:"#70d9d0"});
      kill(nearest,chain.id);
      return true;
    }
    chain.bridges=0;return false;
  }

  function moveGun(dt){
    if(s.pending){
      var want=Math.atan2(s.pending.y-CY,s.pending.x-CX);
      var diff=Math.atan2(Math.sin(want-s.gunAngle),Math.cos(want-s.gunAngle));
      var step=4.25*dt;
      if(Math.abs(diff)<=step+.04){s.gunAngle=want;var shot=s.pending;s.pending=null;fireNow(shot);}
      else s.gunAngle+=Math.sign(diff)*step;
    }else{
      var want2=Math.atan2(s.pointer.y-CY,s.pointer.x-CX);
      var diff2=Math.atan2(Math.sin(want2-s.gunAngle),Math.cos(want2-s.gunAngle));
      s.gunAngle+=clamp(diff2,-1.5*dt,1.5*dt);
    }
  }
  function update(dt){
    s.time+=dt;
    if(s.phase!=="battle")return;
    s.waveTime+=dt;
    if(s.mode==="campaign"){
      while(s.spawnCursor<s.spawnPlan.length && s.spawnPlan[s.spawnCursor].t<=s.waveTime){
        var spawn=s.spawnPlan[s.spawnCursor++];
        addEnemy(spawn.x,spawn.y,spawn.type,spawn.speed);
      }
    }else s.testTime+=dt;
    if(s.charges<maxCharges()){
      s.recharge+=dt;
      if(s.recharge>=config.reload){
        s.charges=Math.min(maxCharges(),s.charges+1);s.recharge-=config.reload;
        if(s.charges===maxCharges())s.recharge=0;
      }
    }else s.recharge=0;

    moveGun(dt);
    s.enemies.forEach(function(en){
      if(en.dead)return;
      var dx=CX-en.x,dy=CY-en.y,d=Math.hypot(dx,dy);
      var speed=en.baseSpeed;
      en.x+=dx/Math.max(1,d)*speed*dt+Math.cos(s.time*1.7+en.wobble)*en.wobblePower*dt;
      en.y+=dy/Math.max(1,d)*speed*dt+Math.sin(s.time*1.4+en.wobble)*en.wobblePower*dt;
      if(d<TOWER+en.radius){
        en.dead=true;
        s.marks=s.marks.filter(function(m){return m.id!==en.id;});
        s.health=clamp(s.health-(en.type==="runner"?6:(en.type==="conductor"?11:8)),0,100);
        s.breaks++;s.shake=.38;
        s.rings.push({x:en.x,y:en.y,r:38,t:0,life:.48,color:"#dd8f8c"});
        s.floaters.push({x:CX+randomBetween(-30,30),y:CY-42,text:"ПРОРЫВ",color:"#de9292",time:0,life:1});
      }
    });

    s.marks.slice().forEach(function(m){
      m.time-=dt;
      if(m.time<=0)detonate(m.id);
    });

    /* Bursts grow quickly, briefly linger and chain to every enemy they reach. */
    s.bursts.forEach(function(b){
      b.time+=dt;
      var frac=clamp(b.time/.35,0,1);
      var radius=b.maxRadius*easeOut(frac);
      s.enemies.forEach(function(en){
        if(en.dead || b.hit[en.id])return;
        if(dist(b.x,b.y,en.x,en.y)<radius+en.radius*.25){
          b.hit[en.id]=true;
          kill(en,b.chainId);
        }
      });
    });
    s.bursts=s.bursts.filter(function(b){return b.time<b.life;});
    /* A bridge is available only after the ordinary chain has finished. */
    Object.keys(s.chains).forEach(function(id){
      var chain=s.chains[id];if(chain.closed)return;
      var active=s.bursts.some(function(b){return b.chainId===chain.id;});
      if(!active){
        if(!tryBridge(chain))chain.closed=true;
      }
    });
    s.enemies=s.enemies.filter(function(e){return !e.dead;});
    s.beams.forEach(function(x){x.time+=dt;});
    s.beams=s.beams.filter(function(x){return x.time<x.life;});
    s.rings.forEach(function(x){x.t+=dt;});
    s.rings=s.rings.filter(function(x){return x.t<x.life;});
    s.sparks.forEach(function(x){x.t+=dt;x.x+=x.vx*dt;x.y+=x.vy*dt;x.vx*=.96;x.vy*=.96;});
    s.sparks=s.sparks.filter(function(x){return x.t<x.life;});
    s.floaters.forEach(function(x){x.time+=dt;x.y-=13*dt;});
    s.floaters=s.floaters.filter(function(x){return x.time<x.life;});
    s.pulse=Math.max(0,s.pulse-dt);s.shake=Math.max(0,s.shake-dt);

    if(s.health<=0){setPhase("defeat");return;}
    if(!s.lastWaveDone && s.enemies.length===0 && !s.bursts.length && !s.pending &&
      (s.mode==="test" || s.spawnCursor>=s.spawnPlan.length)){
      s.lastWaveDone=true;finishWave();
    }
    uiTimer+=dt;
    if(uiTimer>.13){updateUI();uiTimer=0;}
  }

  function line(x1,y1,x2,y2,color,width,alpha){
    ctx.save();ctx.globalAlpha=alpha==null?1:alpha;ctx.strokeStyle=color;ctx.lineWidth=width||1;
    ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();ctx.restore();
  }
  function drawSea(t){
    var grad=ctx.createRadialGradient(CX,CY,14,CX,CY,590);
    grad.addColorStop(0,"#163037");grad.addColorStop(.52,"#0a2026");grad.addColorStop(1,"#061419");
    ctx.fillStyle=grad;ctx.fillRect(0,0,W,H);
    ctx.save();ctx.translate(CX,CY);
    for(var i=0;i<7;i++){
      ctx.beginPath();ctx.ellipse(0,0,90+i*62,75+i*45,0,0,TAU);
      ctx.strokeStyle="rgba(113,160,166,"+(.075-i*.005)+")";ctx.lineWidth=1;ctx.stroke();
    }
    for(var j=0;j<16;j++){
      var angle=j/16*TAU;
      var x1=Math.cos(angle)*87,y1=Math.sin(angle)*82;
      var x2=Math.cos(angle)*550,y2=Math.sin(angle)*440;
      line(x1,y1,x2,y2,"#526f72",1,.052);
    }
    ctx.restore();
    /* moving scratches resemble distant rain on dark water */
    ctx.lineWidth=1;
    for(var k=0;k<55;k++){
      var px=(k*173.27+Math.sin(k*3.7)*55)%W;
      var py=(k*97.3+t*(5+(k%3)*2))%H;
      line(px,py,px+7+(k%4)*6,py-2,"#83a6a7",.8,.08);
    }
    ctx.fillStyle="#88a7ad";ctx.font="10px monospace";ctx.textAlign="center";
    ctx.globalAlpha=.32;
    ctx.fillText("N",CX,28);ctx.fillText("S",CX,H-17);
    ctx.fillText("W",20,CY);ctx.fillText("E",W-20,CY);
    ctx.globalAlpha=1;
    /* scattered shipwreck silhouettes, far from the tower */
    for(var z=0;z<8;z++){
      var a=z*TAU/8+.32,rx=CX+Math.cos(a)*390,ry=CY+Math.sin(a)*278;
      ctx.save();ctx.translate(rx,ry);ctx.rotate(a+Math.PI/2);ctx.globalAlpha=.11;
      ctx.fillStyle="#5d797d";ctx.beginPath();ctx.moveTo(-20,-3);ctx.lineTo(20,-3);
      ctx.lineTo(13,7);ctx.lineTo(-13,7);ctx.closePath();ctx.fill();
      line(0,-3,0,-13,"#91adb1",1,.55);ctx.restore();
    }
  }
  function drawTower(){
    ctx.save();ctx.translate(CX,CY);
    var glow=ctx.createRadialGradient(0,0,11,0,0,118);
    glow.addColorStop(0,"rgba(221,195,129,.27)");glow.addColorStop(.42,"rgba(167,155,110,.09)");
    glow.addColorStop(1,"rgba(167,155,110,0)");
    ctx.fillStyle=glow;ctx.beginPath();ctx.arc(0,0,118,0,TAU);ctx.fill();
    ctx.fillStyle="#081114";ctx.strokeStyle="#a4a392";ctx.lineWidth=2;
    ctx.beginPath();for(var i=0;i<8;i++){var a=(i+.5)*TAU/8;var r=35;var x=Math.cos(a)*r,y=Math.sin(a)*r;
      if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.closePath();ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.arc(0,0,24,0,TAU);ctx.strokeStyle="#6d8684";ctx.lineWidth=1;ctx.stroke();
    for(var j=0;j<8;j++){var a2=j*TAU/8;line(Math.cos(a2)*24,Math.sin(a2)*24,Math.cos(a2)*34,Math.sin(a2)*34,"#658184",1,.6);}
    ctx.rotate(s.gunAngle);
    ctx.fillStyle="#dac58c";ctx.shadowColor="#e7c783";ctx.shadowBlur=17;
    ctx.fillRect(0,-5,51,10);
    ctx.fillStyle="#fff3c1";ctx.fillRect(25,-3,28,6);
    ctx.shadowBlur=0;ctx.rotate(-s.gunAngle);
    ctx.beginPath();ctx.arc(0,0,11,0,TAU);ctx.fillStyle="#cfba86";ctx.fill();
    ctx.beginPath();ctx.arc(0,0,4,0,TAU);ctx.fillStyle="#fff1ba";ctx.fill();
    ctx.restore();
  }
  function drawEnemies(){
    s.enemies.forEach(function(en){
      var radius=en.radius,c=COLORS[en.type];
      ctx.save();ctx.translate(en.x,en.y);
      ctx.rotate(Math.atan2(CY-en.y,CX-en.x));
      ctx.shadowColor=c;ctx.shadowBlur=en.type==="conductor"?15:7;
      ctx.strokeStyle=c;ctx.fillStyle=en.type==="conductor"?"#5a5140":(en.type==="runner"?"#3c394a":"#38545a");
      ctx.lineWidth=1.8;ctx.beginPath();
      ctx.moveTo(radius*1.28,0);
      ctx.lineTo(radius*.24,radius*.85);
      ctx.lineTo(-radius*.82,radius*.56);
      ctx.lineTo(-radius*.65,0);
      ctx.lineTo(-radius*.82,-radius*.56);
      ctx.lineTo(radius*.24,-radius*.85);
      ctx.closePath();ctx.fill();ctx.stroke();ctx.shadowBlur=0;
      ctx.fillStyle=c;ctx.fillRect(0,-1,3,2);
      if(en.type==="conductor"){
        ctx.beginPath();ctx.arc(0,0,4.7,0,TAU);ctx.strokeStyle="#efcf8a";ctx.stroke();
      }
      if(en.mark){
        var m=s.marks.find(function(x){return x.id===en.id;});
        ctx.beginPath();ctx.arc(0,0,radius+7,0,TAU);
        ctx.strokeStyle="#c8b8ec";ctx.setLineDash([3,3]);ctx.lineWidth=1.5;ctx.stroke();ctx.setLineDash([]);
        if(m){ctx.beginPath();ctx.arc(0,0,radius+10,-Math.PI/2,-Math.PI/2+TAU*clamp(m.time/m.initial,0,1));ctx.strokeStyle="#c8b8ec";ctx.lineWidth=2;ctx.stroke();}
      }
      ctx.restore();
    });
  }
  function drawBursts(){
    s.bursts.forEach(function(b){
      var p=clamp(b.time/.35,0,1),r=easeOut(p)*b.base;
      var fade=clamp((b.life-b.time)/Math.min(.55,b.life),0,1);
      var g=ctx.createRadialGradient(b.x,b.y,0,b.x,b.y,Math.max(1,r));
      g.addColorStop(0,"rgba(238,251,221,"+(.34*fade)+")");
      g.addColorStop(.55,"rgba(158,229,198,"+(.17*fade)+")");
      g.addColorStop(1,"rgba(115,215,200,0)");
      ctx.fillStyle=g;ctx.beginPath();ctx.arc(b.x,b.y,Math.max(1,r),0,TAU);ctx.fill();
      ctx.strokeStyle="rgba(181,249,226,"+(.7*fade)+")";ctx.lineWidth=1.6;
      ctx.beginPath();ctx.arc(b.x,b.y,r,0,TAU);ctx.stroke();
      if(config.radii){ctx.strokeStyle="#b2e6b45c";ctx.lineWidth=1;ctx.beginPath();ctx.arc(b.x,b.y,b.base,0,TAU);ctx.stroke();}
    });
  }
  function drawEffects(){
    s.beams.forEach(function(b){
      var alpha=Math.pow(1-b.time/b.life,1.1);
      line(b.x1,b.y1,b.x2,b.y2,b.bridge?"#79eadb":(b.mark?"#c2adf4":"#f9d698"),b.bridge?5:7,alpha*.24);
      line(b.x1,b.y1,b.x2,b.y2,b.bridge?"#a5fff3":(b.mark?"#d9c7f6":"#fff2bd"),b.bridge?2:2.5,alpha);
    });
    s.rings.forEach(function(r){
      var p=r.t/r.life;
      ctx.save();ctx.globalAlpha=(1-p)*.76;
      ctx.strokeStyle=r.color;ctx.lineWidth=2.1*(1-p)+.5;
      ctx.beginPath();ctx.arc(r.x,r.y,r.r*(.25+.9*easeOut(p)),0,TAU);ctx.stroke();ctx.restore();
    });
    s.sparks.forEach(function(p){
      ctx.globalAlpha=1-p.t/p.life;ctx.fillStyle=p.c;ctx.fillRect(p.x,p.y,2.4,2.4);
    });ctx.globalAlpha=1;
    ctx.save();ctx.font="11px ui-monospace, monospace";ctx.textAlign="center";
    s.floaters.forEach(function(f){
      ctx.globalAlpha=clamp(1-f.time/f.life,0,1);
      ctx.fillStyle=f.color;ctx.fillText(f.text,f.x,f.y);
    });ctx.restore();
    if(s.pulse>0){
      ctx.fillStyle="rgba(240,223,170,"+(s.pulse*.12)+")";ctx.fillRect(0,0,W,H);
    }
  }
  function drawReticle(){
    if(s.phase!=="battle")return;
    var x=s.pointer.x,y=s.pointer.y;
    ctx.save();ctx.strokeStyle=s.shotMode==="mark"?"#b6a4dc":"#d4bb83";ctx.globalAlpha=.8;
    ctx.lineWidth=1;
    ctx.beginPath();ctx.arc(x,y,16,0,TAU);ctx.stroke();
    line(x-24,y,x-11,y,ctx.strokeStyle,1,.75);line(x+11,y,x+24,y,ctx.strokeStyle,1,.75);
    line(x,y-24,x,y-11,ctx.strokeStyle,1,.75);line(x,y+11,x,y+24,ctx.strokeStyle,1,.75);
    if(s.pending){line(CX,CY,s.pending.x,s.pending.y,"#b8bcb4",1,.28);}
    ctx.restore();
  }
  function render(){
    ctx.save();
    if(s.shake>0){ctx.translate((Math.sin(s.time*84)*s.shake)*4,(Math.cos(s.time*76)*s.shake)*4);}
    drawSea(s.time);
    drawTower();
    drawBursts();
    drawEnemies();
    drawEffects();
    drawReticle();
    ctx.restore();
  }
  function frame(time){
    var dt=clamp((time-lastFrame)/1000,0,.05);lastFrame=time;
    if(s)update(dt);
    render();
    requestAnimationFrame(frame);
  }

  function updateUI(){
    $("healthValue").textContent=Math.ceil(s.health);
    $("healthBar").style.width=s.health+"%";
    $("healthStatus").textContent=s.health>65?"СТАБИЛЬНО":(s.health>25?"ПОВРЕЖДЕНИЯ":"КРИТИЧЕСКИ");
    $("healthStatus").style.color=s.health<=25?"#cf8581":(s.health<=65?"#c2a16b":"#7ebbb4");
    $("healthBar").style.background=s.health>65?"#a9c8b0":(s.health>25?"#c2a16b":"#c47b7a");
    $("moduleName").textContent=MODULES[s.module].name;
    $("moduleLevel").textContent=s.level?"УРОВЕНЬ "+roman(s.level):"—";
    $("moduleDetail").textContent=s.module==="none"?
      "Выбор нового модуля — после первой волны.":MODULES[s.module].info;
    $("waveStat").innerHTML=(s.mode==="test"?"ОПЫТ":String(s.wave||0).padStart(2,"0"))+(s.mode==="test"?"":" <small>/ 05</small>");
    $("threatStat").textContent=s.enemies.length+(s.mode==="campaign"&&s.wave?s.spawnPlan.length-s.spawnCursor:0);
    $("killStat").textContent=s.kills;
    $("bestStat").textContent="×"+s.bestChain;
    $("gunStatus").textContent=s.pending?"Поворот к цели":(s.charges>0?"Готова к импульсу":"Заряд через "+number(Math.max(0,config.reload-s.recharge),1)+" с");
    $("gunDetail").textContent=s.shots?("Выстрелов: "+s.shots+" · "+number(config.reload,1)+" с / заряд"):
      "Наведи на стаю · "+number(config.reload,1)+" с / заряд";
    $("chargeBar").style.width=(s.charges>=maxCharges()?100:clamp(s.recharge/config.reload*100,0,100))+"%";
    var chargeHTML="";
    for(var i=0;i<maxCharges();i++)chargeHTML+='<span class="charge-token'+(i<s.charges?" active":"")+'"></span>';
    $("chargeTokens").innerHTML=chargeHTML;
    $("modeLabel").textContent=s.module==="delayed"?
      (s.shotMode==="mark"?"РЕЖИМ МЕТКИ · "+s.marks.length+"/"+maxMarks():"ОБЫЧНЫЙ ИМПУЛЬС · Q ДЛЯ МЕТКИ"):"ОБЫЧНЫЙ ИМПУЛЬС";
    $("toggleModeBtn").classList.toggle("hidden",s.module!=="delayed"||s.phase!=="battle");
    $("toggleModeBtn").textContent=s.shotMode==="mark"?"Перейти к обычному импульсу":"Перейти к постановке метки";
    $("detonateBtn").classList.toggle("hidden",s.module!=="delayed"||s.level<2||s.phase!=="battle");
    $("detonateBtn").textContent="Подорвать метки ("+s.marks.length+")";
    $("pauseBtn").textContent=s.phase==="pause"?"▶ Продолжить":"Ⅱ  Пауза";
    $("streak").textContent=s.bestChain>2?"ЛУЧШАЯ ЦЕПЬ × "+s.bestChain:"";
  }

  function bindSettings(){
    function bindRange(id,out,fmt,key){
      $(id).addEventListener("input",function(){
        config[key]=Number(this.value);$(out).textContent=fmt(config[key]);
      });
    }
    bindRange("radiusInput","radiusValue",function(x){return String(x);},"radius");
    bindRange("durationInput","durationValue",function(x){return number(x,2)+" с";},"duration");
    bindRange("reloadInput","reloadValue",function(x){return number(x,1)+" с";},"reload");
    $("showRadii").addEventListener("change",function(){config.radii=this.checked;});
    $("resetSettingsBtn").addEventListener("click",function(){
      config={radius:52,duration:1.25,reload:2.1,radii:false};
      $("radiusInput").value=52;$("radiusValue").textContent="52";
      $("durationInput").value=1.25;$("durationValue").textContent="1,25 с";
      $("reloadInput").value=2.1;$("reloadValue").textContent="2,1 с";
      $("showRadii").checked=false;toast("Исходные параметры восстановлены.");
    });
  }
  function toggleShotMode(){
    if(s.module!=="delayed"||s.phase!=="battle")return;
    s.shotMode=s.shotMode==="normal"?"mark":"normal";
    toast(s.shotMode==="mark"?"Режим отложенной метки":"Режим обычного импульса");
    updateUI();
  }
  function copyReport(){
    var report=[
      "LIGHTHOUSE — результат плейтеста",
      "Режим: "+(s.mode==="test"?"Испытательная акватория":"Пять волн"),
      "Волна: "+s.wave+"/5",
      "Целостность: "+Math.ceil(s.health)+"%",
      "Усиление: "+MODULES[s.module].name+(s.level?" / "+roman(s.level):""),
      "Параметры: радиус "+config.radius+"; свет "+number(config.duration,2)+" с; заряд "+number(config.reload,1)+" с",
      "Повержено: "+s.kills+", прорывов: "+s.breaks+", импульсов: "+s.shots+", лучшая цепь: "+s.bestChain,
      "",
      "Что было наиболее увлекательным?",
      "Как модуль изменил твою тактику?",
      "Захотелось ли пройти ещё раз с другим улучшением?"
    ].join("\n");
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(report).then(function(){toast("Отчёт скопирован.");},function(){fallbackCopy(report);});
    }else fallbackCopy(report);
  }
  function fallbackCopy(str){
    var t=document.createElement("textarea");t.value=str;document.body.appendChild(t);t.select();
    var ok=false;try{ok=document.execCommand("copy");}catch(e){}
    t.remove();toast(ok?"Отчёт скопирован.":"Выделить отчёт автоматически не удалось.");
  }

  overlay.addEventListener("click",function(e){
    var node=e.target.closest("[data-action]");if(!node)return;
    var action=node.dataset.action;
    if(action==="campaign")start("campaign");
    else if(action==="test")start("test");
    else if(action==="resume")pauseOrResume();
    else if(action==="restart")start(s.mode);
    else if(action==="next")startWave(s.wave+1);
    else if(action==="selectModule")chooseModule(node.dataset.module);
    else if(action==="copy")copyReport();
    else if(action==="closeHelp"){
      if(overlay.dataset.previous==="battle"){s.phase="battle";hideOverlay();}
      else showOverlay(s.phase==="intro"?"intro":"pause");
    }
  });
  canvas.addEventListener("pointermove",function(e){setPointer(pointerPosition(e));});
  canvas.addEventListener("pointerdown",function(e){
    e.preventDefault();var pos=pointerPosition(e);setPointer(pos);
    if(e.button===2)requestFire(pos,true);else requestFire(pos,false);
  });
  canvas.addEventListener("contextmenu",function(e){e.preventDefault();});
  window.addEventListener("keydown",function(e){
    var tag=(e.target&&e.target.tagName)||"";
    if(tag==="INPUT"||tag==="SELECT"||tag==="TEXTAREA")return;
    var key=e.key.toLowerCase();
    if(key===" "){e.preventDefault();requestFire(s.pointer,false);}
    else if(key==="p"||key==="escape"){if(s.phase==="battle"||s.phase==="pause")pauseOrResume();}
    else if(key==="r"){start(s.mode);}
    else if(key==="q"){toggleShotMode();}
    else if(key==="e"){detonateMarks();}
    else if(s.phase==="workshop" && (key==="1"||key==="2"||key==="3")){
      var modules=s.wave===1?["capacitor","delayed","bridge"]:[s.module];
      chooseModule(modules[Number(key)-1]);
    }
  });
  $("pauseBtn").addEventListener("click",pauseOrResume);
  $("restartBtn").addEventListener("click",function(){start(s.mode);});
  $("startTestBtn").addEventListener("click",function(){start("test");});
  $("testShortcut").addEventListener("click",function(){
    $("testingFold").open=true;
    if(s.phase==="intro"||s.phase==="defeat"||s.phase==="victory"||s.phase==="testclear"){
      start("test");
    }else toast("Открой испытательную акваторию справа и нажми «Повторить опыт».");
  });
  $("copyReportBtn").addEventListener("click",copyReport);
  $("toggleModeBtn").addEventListener("click",toggleShotMode);
  $("detonateBtn").addEventListener("click",detonateMarks);
  $("helpBtn").addEventListener("click",function(){
    if(s.phase==="battle"){s.phase="pause";showOverlay("help","battle");}
    else showOverlay("help",s.phase==="intro"?"intro":"pause");
  });
  window.addEventListener("blur",function(){if(s.phase==="battle")setPhase("pause");});
  bindSettings();
  showOverlay("intro");
  updateUI();
  requestAnimationFrame(frame);
})();

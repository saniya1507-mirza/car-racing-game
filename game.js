// Endless Racer - single-file engine (modular but bundled into one for easy copy-paste).
(() => {
  // Config
  const cfg = {
    baseRoadWidthRatio: 0.5,   // portion of canvas width
    laneCount: 3,
    playerWidthRatio: 0.08,    // portion of canvas width
    playerHeightRatio: 0.12,
    initialSpeed: 300,         // pixels per second for obstacles moving down
    speedIncrease: 12,         // incremental acceleration (px/s^2)
    maxSpeed: 1500,
    spawnInterval: 0.9,        // seconds between spawns initially
    minSpawnInterval: 0.28,
    spawnDecreaseRate: 0.002,  // per second
    obstacleWidthRatio: 0.08,
    obstacleHeightRatio: 0.14,
    laneMarkerHeight: 40,
    laneMarkerGap: 26,
    treeSpawnGap: 0.9,
    signSpawnGap: 1.7,
    scoreScale: 0.02,
    pushBackStrength: 8,
    steeringSpeed: 1100,       // how quickly targetX changes with input
    movementSmoothing: 0.12    // lower = tighter control (0.12 works nicely)
  };

  // DOM
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const scoreEl = document.getElementById('score');
  const highEl = document.getElementById('highscore');
  const overlay = document.getElementById('overlay');
  const goScore = document.getElementById('go-score');
  const goHigh = document.getElementById('go-highscore');
  const restartBtn = document.getElementById('restartBtn');
  const touchControls = document.getElementById('touch-controls');
  const leftBtn = document.getElementById('leftBtn');
  const rightBtn = document.getElementById('rightBtn');

  // State
  let W = 1024, H = 768;
  let dpr = window.devicePixelRatio || 1;

  let road = {
    x: 0, width: 0, left: 0, right: 0, laneWidth: 0,
    markerOffset: 0,
  };

  const input = {
    left: false, right: false,
    touchLeft: false, touchRight: false,
    pointerDown: false
  };

  let player, obstacles, trees, signs;
  let lastTime = 0, running = false;
  let speed = cfg.initialSpeed;
  let spawnTimer = 0, treeTimer = 0, signTimer = 0;
  let spawnInterval = cfg.spawnInterval;
  let score = 0;
  let highscore = 0;
  let gameOver = false;
  const HS_KEY = 'endlessRacerHighScore_v1';

  // Audio
  let audioCtx = null;
  let engineOsc = null;
  let engineGain = null;
  let musicOsc = null;

  // Helper
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function rand(a,b){ return a + Math.random()*(b-a); }

  // Resize handling
  function resize(){
    dpr = window.devicePixelRatio || 1;
    W = Math.max(480, window.innerWidth);
    H = Math.max(320, window.innerHeight);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    // Road geometry
    road.width = W * cfg.baseRoadWidthRatio;
    road.x = (W - road.width)/2;
    road.left = road.x;
    road.right = road.x + road.width;
    road.laneWidth = road.width / cfg.laneCount;
  }

  // Initialize or reset the game
  function resetGame(){
    speed = cfg.initialSpeed;
    spawnInterval = cfg.spawnInterval;
    spawnTimer = 0;
    treeTimer = 0;
    signTimer = 0;
    score = 0;
    gameOver = false;
    overlay.classList.add('hidden');
    obstacles = [];
    trees = [];
    signs = [];
    // Player placed near bottom center of road
    player = {
      x: W*0.5,
      y: H - H*0.18,
      w: W * cfg.playerWidthRatio,
      h: W * cfg.playerHeightRatio,
      vx: 0,
      targetX: W*0.5,
      alive: true
    };
    // Camera marker offset for lane markers
    road.markerOffset = 0;
    updateScoreDisplay();
  }

  // Input
  function bindInput(){
    window.addEventListener('keydown', (e)=>{
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') input.left = true;
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') input.right = true;
      if (e.key === ' ' && gameOver) restart();
      // Start audio on first user interaction if necessary
      if (!audioCtx) tryStartAudio();
    });
    window.addEventListener('keyup', (e)=>{
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') input.left = false;
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') input.right = false;
    });
    // Touch controls: full-screen left/right tap + on-screen buttons
    canvas.addEventListener('touchstart', (e)=>{
      e.preventDefault();
      const t = e.touches[0];
      const x = t.clientX;
      if (x < W/2) { input.touchLeft = true; } else { input.touchRight = true; }
      tryStartAudio();
    }, {passive:false});
    canvas.addEventListener('touchend', (e)=>{
      input.touchLeft = false; input.touchRight = false;
    });

    leftBtn.addEventListener('touchstart', (e)=>{ e.preventDefault(); input.touchLeft=true; tryStartAudio(); }, {passive:false});
    leftBtn.addEventListener('touchend', ()=>{ input.touchLeft=false; });
    rightBtn.addEventListener('touchstart', (e)=>{ e.preventDefault(); input.touchRight=true; tryStartAudio(); }, {passive:false});
    rightBtn.addEventListener('touchend', ()=>{ input.touchRight=false; });

    // Mouse support: left or right half click and hold
    canvas.addEventListener('mousedown', (e)=>{
      input.pointerDown = true;
      if (e.clientX < W/2) input.touchLeft = true; else input.touchRight = true;
      tryStartAudio();
    });
    window.addEventListener('mouseup', ()=>{ input.pointerDown=false; input.touchLeft=false; input.touchRight=false; });

    // Restart button
    restartBtn.addEventListener('click', ()=>{ restart(); });

    // Window resize
    window.addEventListener('resize', resize);
  }

  // Audio init (on first gesture)
  function tryStartAudio(){
    if (audioCtx) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      // engine oscillator
      engineOsc = audioCtx.createOscillator();
      engineGain = audioCtx.createGain();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 80;
      engineGain.gain.value = 0.0005; // subtle low rumble
      engineOsc.connect(engineGain);
      const compressor = audioCtx.createDynamicsCompressor();
      engineGain.connect(compressor);
      compressor.connect(audioCtx.destination);
      engineOsc.start(0);

      // small background "music" - sine drone
      musicOsc = audioCtx.createOscillator();
      const musicGain = audioCtx.createGain();
      musicOsc.type = 'sine';
      musicOsc.frequency.value = 120;
      musicGain.gain.value = 0.00025;
      musicOsc.connect(musicGain);
      musicGain.connect(audioCtx.destination);
      musicOsc.start(0);
    } catch (err) {
      console.warn('Audio disabled:', err);
    }
  }

  function playCrashSound(){
    if (!audioCtx) return;
    const ctx = audioCtx;
    const bufferSize = ctx.sampleRate * 0.35;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i=0;i<bufferSize;i++){
      data[i] = (Math.random()*2-1) * Math.exp(-3*i/bufferSize) * (0.6 + Math.random()*0.4);
    }
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = 0.7;
    src.buffer = buffer;
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start(0);
  }

  // Spawning obstacles
  function spawnObstacle(){
    // Choose lane or between lanes
    const lane = Math.floor(Math.random()*cfg.laneCount);
    const laneCenter = road.left + (lane + 0.5)*road.laneWidth;
    const w = W * cfg.obstacleWidthRatio;
    const h = W * cfg.obstacleHeightRatio;
    const x = clamp(laneCenter, road.left + w/2, road.right - w/2);
    obstacles.push({
      x: x,
      y: -h - rand(10,120),
      w: w,
      h: h,
      speed: speed * (0.9 + Math.random()*0.6),
      color: randCarColor(),
      wobble: Math.random()*40 - 20
    });
  }

  function randCarColor(){
    const choices = ['#e25822','#ffcd3c','#29a19c','#6a8cff','#c961d6','#d9534f','#ff7ba9'];
    return choices[Math.floor(Math.random()*choices.length)];
  }

  function spawnTree(side){
    const h = rand(35,85);
    trees.push({
      x: side === 'left' ? road.left - rand(40,120) : road.right + rand(40,120),
      y: -rand(40,200),
      w: rand(14,28),
      h: h,
      side: side,
      speed: speed * (0.6 + Math.random()*0.6),
      color: side === 'left' ? '#226633' : '#2b6b2b'
    });
  }

  function spawnSign(){
    const side = Math.random() < 0.5 ? 'left' : 'right';
    signs.push({
      x: side === 'left' ? road.left - 18 : road.right + 18,
      y: -rand(10,300),
      w: 18,
      h: 26,
      speed: speed * (0.85 + Math.random()*0.4),
      side
    });
  }

  // Collision
  function rectsOverlap(a,b){
    return !(a.x + a.w*0.5 < b.x - b.w*0.5 ||
             a.x - a.w*0.5 > b.x + b.w*0.5 ||
             a.y + a.h*0.5 < b.y - b.h*0.5 ||
             a.y - a.h*0.5 > b.y + b.h*0.5);
  }

  // Update loop
  function update(dt){
    if (gameOver) return;
    // Increase difficulty
    speed = clamp(speed + cfg.speedIncrease * dt, cfg.initialSpeed, cfg.maxSpeed);
    spawnInterval = clamp(spawnInterval - cfg.spawnDecreaseRate * dt, cfg.minSpawnInterval, cfg.spawnInterval);

    spawnTimer -= dt;
    if (spawnTimer <= 0){
      spawnTimer = spawnInterval * (0.7 + Math.random()*0.9);
      spawnObstacle();
      // occasionally spawn clusters
      if (Math.random() < clamp(0.08 + score/8000, 0, 0.6)){
        // spawn an extra one slightly offset
        setTimeout(spawnObstacle, 120 + Math.random()*220);
      }
    }

    treeTimer -= dt;
    if (treeTimer <= 0){
      treeTimer = cfg.treeSpawnGap * (0.4 + Math.random()*1.2);
      spawnTree(Math.random() < 0.5 ? 'left' : 'right');
    }

    signTimer -= dt;
    if (signTimer <= 0){
      signTimer = cfg.signSpawnGap * (0.6 + Math.random()*1.8);
      spawnSign();
    }

    // Input handling -> targetX
    let steer = 0;
    if (input.left || input.touchLeft) steer -= 1;
    if (input.right || input.touchRight) steer += 1;
    const steerAmt = steer * cfg.steeringSpeed * dt;
    player.targetX = clamp(player.targetX + steerAmt, road.left + player.w*0.5, road.right - player.w*0.5);

    // Smooth movement toward target
    const dx = player.targetX - player.x;
    player.vx += dx * (cfg.movementSmoothing * 60) * dt;
    // damp
    player.vx *= (1 - Math.min(0.12, dt*6));
    player.x += player.vx * dt;

    // Prevent driving off the road - smooth push back
    const leftEdge = road.left + player.w*0.5;
    const rightEdge = road.right - player.w*0.5;
    if (player.x < leftEdge){
      // apply push
      player.x += (leftEdge - player.x) * Math.min(1, cfg.pushBackStrength * dt);
      player.vx *= 0.6;
    } else if (player.x > rightEdge){
      player.x -= (player.x - rightEdge) * Math.min(1, cfg.pushBackStrength * dt);
      player.vx *= 0.6;
    }

    // Update obstacles
    for (let i = obstacles.length - 1; i >= 0; i--){
      const o = obstacles[i];
      o.y += o.speed * dt;
      // slight lateral wobble
      o.x += Math.sin((o.y + o.w) * 0.008) * 0.15;
      if (o.y - o.h > H + 120) obstacles.splice(i,1);
      else {
        // collision
        const pl = { x: player.x, y: player.y, w: player.w, h: player.h };
        const obRect = { x: o.x, y: o.y, w: o.w, h: o.h };
        if (rectsOverlap(pl, obRect)){
          // crash!
          triggerGameOver();
          return;
        }
      }
    }

    // Update trees and signs
    for (let i = trees.length -1; i>=0; i--){
      const t = trees[i];
      t.y += t.speed * dt;
      if (t.y - t.h > H + 100) trees.splice(i,1);
    }
    for (let i = signs.length -1; i>=0; i--){
      const s = signs[i];
      s.y += s.speed * dt;
      if (s.y - s.h > H + 100) signs.splice(i,1);
    }

    // Update lane markers scroll
    road.markerOffset += speed * dt;
    // Score
    score += speed * dt * cfg.scoreScale;
    updateScoreDisplay();

    // update audio pitch/gain
    if (audioCtx && engineOsc){
      const f = 70 + (speed - cfg.initialSpeed) * 0.03;
      engineOsc.frequency.setTargetAtTime(clamp(f, 60, 500), audioCtx.currentTime, 0.05);
      // engine gain slightly increase with speed
      engineGain.gain.setTargetAtTime(0.0004 + (speed - cfg.initialSpeed)*0.000003, audioCtx.currentTime, 0.1);
      if (musicOsc){
        musicOsc.frequency.setTargetAtTime(90 + Math.sin(score*0.003)*8, audioCtx.currentTime, 0.4);
      }
    }
  }

  // Draw loop
  function draw(){
    // sky/ground
    ctx.fillStyle = '#21303a';
    ctx.fillRect(0,0,W,H);

    // grass sides
    ctx.fillStyle = '#127029';
    ctx.fillRect(0,0,road.left,H);
    ctx.fillStyle = '#0d3f2a';
    ctx.fillRect(road.right,0,W-road.right,H);

    // render distant parallax (buildings)
    drawBuildings();

    // road
    const rx = road.x;
    const rw = road.width;
    // road base
    ctx.fillStyle = '#30363c';
    ctx.fillRect(rx,0,rw,H);

    // road side gradient
    const g = ctx.createLinearGradient(rx,0,rx+rw,0);
    g.addColorStop(0, 'rgba(0,0,0,0.06)');
    g.addColorStop(0.06, 'rgba(255,255,255,0.02)');
    g.addColorStop(0.94, 'rgba(255,255,255,0.02)');
    g.addColorStop(1, 'rgba(0,0,0,0.06)');
    ctx.fillStyle = g;
    ctx.fillRect(rx,0,rw,H);

    // lane markers (dashed, moving)
    const laneW = road.laneWidth;
    ctx.fillStyle = '#e9eaeb';
    ctx.globalAlpha = 0.92;
    for (let i=1;i<cfg.laneCount;i++){
      const cx = rx + i*laneW;
      // draw short dash segments down the screen with offset
      const segH = cfg.laneMarkerHeight;
      const gap = cfg.laneMarkerGap;
      const start = -((road.markerOffset)% (segH + gap));
      for (let y = start; y < H + segH; y += segH + gap) {
        ctx.fillRect(cx - 2, y, 4, segH);
      }
    }
    ctx.globalAlpha = 1;

    // roadside stripes
    ctx.fillStyle = '#111';
    ctx.fillRect(rx-6, 0, 6, H);
    ctx.fillRect(road.right, 0, 6, H);
    // white edges
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.08;
    ctx.fillRect(rx-3, 0, 3, H);
    ctx.fillRect(road.right, 0, 3, H);
    ctx.globalAlpha = 1;

    // draw signs and trees behind cars (parallax)
    for (const s of signs) drawSign(s);
    for (const t of trees) drawTree(t);

    // obstacles
    for (const o of obstacles){
      drawCar(o);
    }

    // draw player with subtle shadow and tilt based on vx
    drawPlayerCar();

    // HUD overlay components are DOM-based, not canvas.
  }

  function drawCar(o){
    ctx.save();
    ctx.translate(o.x, o.y);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, o.h*0.38, o.w*0.58, o.h*0.26, 0, 0, Math.PI*2);
    ctx.fill();

    // body
    ctx.fillStyle = o.color;
    roundRect(ctx, -o.w*0.5, -o.h*0.5, o.w, o.h, 6);
    ctx.fill();

    // windows
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    roundRect(ctx, -o.w*0.28, -o.h*0.35, o.w*0.56, o.h*0.32, 3);
    ctx.fill();

    // details
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(-o.w*0.45, -o.h*0.18, o.w*0.18, o.h*0.06);
    ctx.fillRect(o.w*0.27, -o.h*0.18, o.w*0.18, o.h*0.06);

    ctx.restore();
  }

  function drawPlayerCar(){
    ctx.save();
    ctx.translate(player.x, player.y);
    const tilt = clamp(player.vx * 0.02, -0.28, 0.28);
    ctx.rotate(tilt);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.beginPath();
    ctx.ellipse(0, player.h*0.36, player.w*0.62, player.h*0.26, 0, 0, Math.PI*2);
    ctx.fill();

    // body
    ctx.fillStyle = '#ffd34a';
    roundRect(ctx, -player.w*0.5, -player.h*0.5, player.w, player.h, 6);
    ctx.fill();

    // windows
    ctx.fillStyle = 'rgba(0,0,0,0.24)';
    roundRect(ctx, -player.w*0.28, -player.h*0.35, player.w*0.56, player.h*0.32, 3);
    ctx.fill();

    // sporty stripes
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(-player.w*0.1, -player.h*0.5 + 6, player.w*0.2, player.h*0.48);

    ctx.restore();
  }

  function drawTree(t){
    ctx.save();
    ctx.translate(t.x, t.y);
    // trunk shadow
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(-2, t.h*0.5, 6, 4);
    // trunk
    ctx.fillStyle = '#6b3f20';
    ctx.fillRect(-3, -t.h*0.2, 6, t.h*0.4);
    // leaves
    ctx.fillStyle = t.color;
    ctx.beginPath();
    ctx.ellipse(0, -t.h*0.25, t.w*1.4, t.h*0.6, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }

  function drawSign(s){
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.fillStyle = '#e4e4e4';
    ctx.fillRect(-2, -s.h*0.5, 4, s.h); // pole
    ctx.fillStyle = '#ffd35a';
    roundRect(ctx, s.side === 'left' ? -s.w - 6 : 6, -s.h*0.5, s.w, s.h, 4);
    ctx.fill();
    ctx.restore();
  }

  function drawBuildings(){
    // simple repeating rectangles in horizon for parallax
    const n = 10;
    for (let i=0;i<n;i++){
      const bw = 40 + (i%3)*20;
      const bx = (i/n) * W + (Math.sin(i*0.9 + Date.now()*0.0004)*40);
      const by = Math.max(40, H*0.08 + i*3);
      const bh = 30 + (i%4) * 20;
      ctx.fillStyle = 'rgba(10,12,14,0.35)';
      ctx.fillRect(bx % (W+200) - 60, by, bw, bh);
    }
  }

  // Utilities
  function roundRect(ctx, x, y, w, h, r){
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x+rr, y);
    ctx.arcTo(x+w, y, x+w, y+h, rr);
    ctx.arcTo(x+w, y+h, x, y+h, rr);
    ctx.arcTo(x, y+h, x, y, rr);
    ctx.arcTo(x, y, x+w, y, rr);
    ctx.closePath();
  }

  // Game over
  function triggerGameOver(){
    gameOver = true;
    playCrashSound();
    if (audioCtx) {
      // fade engine out
      engineGain.gain.setTargetAtTime(0.00005, audioCtx.currentTime, 0.6);
    }
    // update highscore
    const sf = Math.floor(score);
    if (sf > highscore){
      highscore = sf;
      try { localStorage.setItem(HS_KEY, String(highscore)); } catch(e){}
    }

    // show overlay
    goScore.textContent = `Score: ${Math.floor(score)}`;
    goHigh.textContent = `Highscore: ${highscore}`;
    overlay.classList.remove('hidden');
  }

  function restart(){
    resetGame();
    // restore audio gain smoothly
    if (audioCtx && engineGain) engineGain.gain.setTargetAtTime(0.00045, audioCtx.currentTime, 0.08);
    lastTime = performance.now();
    gameOver = false;
    // hide overlay
    overlay.classList.add('hidden');
  }

  function updateScoreDisplay(){
    scoreEl.textContent = `SCORE: ${Math.floor(score)}`;
    highEl.textContent = `HIGH: ${highscore}`;
  }

  // Load highscore
  function loadHighscore(){
    try {
      const v = localStorage.getItem(HS_KEY);
      highscore = v ? parseInt(v,10) || 0 : 0;
    } catch (e){
      highscore = 0;
    }
    updateScoreDisplay();
  }

  // Main loop
  function loop(ts){
    if (!lastTime) lastTime = ts;
    const dt = Math.min(0.05, (ts - lastTime)/1000);
    lastTime = ts;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  // Start everything
  function start(){
    resize();
    bindInput();
    loadHighscore();

    // decide whether to show touch controls
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0){
      touchControls.classList.remove('hidden');
    }

    resetGame();
    running = true;
    requestAnimationFrame(loop);
  }

  // Kicks off audio and unlocks on first user interaction
  function userGestureStart(){
    if (!audioCtx) tryStartAudio();
    window.removeEventListener('pointerdown', userGestureStart);
    window.removeEventListener('touchstart', userGestureStart);
    window.removeEventListener('keydown', userGestureStart);
  }
  window.addEventListener('pointerdown', userGestureStart);
  window.addEventListener('touchstart', userGestureStart);
  window.addEventListener('keydown', userGestureStart);

  // Init
  start();

  // Expose restart in console for testing
  window.endlessRacer = { restart };

})();

/**
 * TABLE TENNIS — 15 CHALLENGE
 * True 3D Perspective Table Tennis Physics & Rendering Engine
 * Simulates official table dimensions, net, 40mm ball, 3D trajectory,
 * gravity, table bounce, net collision, Magnus spin (Topspin/Backspin/Sidespin),
 * Forehand/Backhand, Serves, Smashes, Blocks, and escalating 15-phase AI.
 */

class TableTennisGame {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');

    // Virtual resolution
    this.width = 1100;
    this.height = 680;
    this.canvas.width = this.width;
    this.canvas.height = this.height;

    // Camera & 3D Perspective Projection parameters
    // Coordinate system:
    // X: lateral across table (-width/2 = left, +width/2 = right)
    // Y: vertical elevation above table (0 = table top surface, +Y = upwards in air)
    // Z: longitudinal depth (0 = player baseline, net at Z = L/2, opponent baseline at Z = L)
    this.tableRealWidth = 152.5; // cm (standard 1.525m)
    this.tableRealLength = 274;  // cm (standard 2.74m)
    this.netHeight = 15.25;      // cm (standard 15.25cm)
    this.ballRadiusReal = 2.0;   // cm (40mm ball)

    // Virtual 3D scale units
    this.tableW = 490;   // virtual X width (extra wide tournament table)
    this.tableL = 600;   // virtual Z length
    this.netZ = this.tableL / 2; // 300
    this.netH = 34;      // virtual Y net height (realistic ITTF proportions)

    // Camera position (behind and slightly above player end)
    this.cam = {
      x: 0,
      y: 190,
      z: -170,
      fov: 340,
      horizonY: 260,
    };

    // Match State
    this.isRunning = false;
    this.isPaused = false;
    this.isGameOver = false;
    this.countdown = 0;
    this.countdownTimer = null;
    this.minPointsToWin = 12;
    this.minLead = 2;

    this.playerScore = 0;
    this.aiScore = 0;
    this.currentPhase = 1;
    this.matchStartTime = 0;
    this.matchElapsedSeconds = 0;

    // Service state
    this.server = 'player'; // 'player' or 'ai'
    this.servicePhase = 'ready'; // 'ready', 'toss', 'in_play'
    this.serviceCount = 0;
    this.isServeFlight = false; // Tracks serve trajectory to guarantee clearing net

    // Rally tracking
    this.lastHitter = null; // 'player' or 'ai'
    this.bouncesPlayerSide = 0;
    this.bouncesAiSide = 0;
    this.netTouchInRally = false;
    this.rallyLength = 0;

    // Ball 3D state
    this.gravity = 980; // realistic table tennis vertical acceleration
    this.ball = {
      x: 0,
      y: 35,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      spinX: 0, // Topspin (+) or Backspin (-)
      spinY: 0, // Sidespin
      radius: 9,
      trail: [],
    };

    // Player Paddle (Foreground, 3D)
    this.player = {
      x: 0,
      y: 40,
      z: -30,
      vx: 0,
      vy: 0,
      prevX: 0,
      prevY: 0,
      angleZ: 0,
      isForehand: true,
      swingProgress: 0,
      swingType: 'drive', // 'topspin', 'backspin', 'smash', 'block', 'drive'
      reach: 75,
      height: 95,
      width: 78,
    };

    // AI Paddle (Background, 3D)
    this.ai = {
      x: 0,
      y: 40,
      z: this.tableL + 30,
      targetX: 0,
      targetY: 40,
      speedX: 420,
      speedY: 280,
      lerp: 0.08,
      errorOffset: 0,
      spinProficiency: 0.1,
      smashChance: 0.1,
      isForehand: false,
      swingProgress: 0,
      swingType: 'drive',
      height: 80,
      width: 65,
    };

    // Active skills state
    this.skillsState = {
      skill_speed: { active: false, timer: 0, cooldownRemaining: 0, cooldownMax: 12 },
      skill_shield: { active: false, timer: 0, cooldownRemaining: 0, cooldownMax: 18, hitsLeft: 1 },
      skill_smash: { active: false, charged: false, cooldownRemaining: 0, cooldownMax: 10 },
      skill_freeze: { active: false, timer: 0, cooldownRemaining: 0, cooldownMax: 15 },
      skill_precision: { active: false, timer: 0, cooldownRemaining: 0, cooldownMax: 14 },
      skill_turbo: { active: false, timer: 0, cooldownRemaining: 0, cooldownMax: 16 },
    };

    // Visuals & Effects
    this.particles = [];
    this.floatingTexts = [];
    this.screenshake = 0;
    this.lastShotFeedback = '';

    // Inputs
    this.keys = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false, KeyW: false, KeyS: false, KeyA: false, KeyD: false };
    this.mouseInput = { x: 0, y: 0, isDown: false, moved: false };

    // Callbacks
    this.onPhaseWin = null;
    this.onPhaseLose = null;
    this.onScoreUpdate = null;
    this.onSkillUpdate = null;

    this.setupListeners();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // --- 3D PERSPECTIVE PROJECTION ---
  project3D(x, y, z) {
    const relZ = z - this.cam.z;
    if (relZ <= 5) return { x: this.width / 2, y: this.height / 2, scale: 0, visible: false };

    const scale = this.cam.fov / relZ;
    const screenX = this.width / 2 + (x - this.cam.x) * scale;
    const screenY = this.cam.horizonY + (this.cam.y - y) * scale;

    return {
      x: screenX,
      y: screenY,
      scale: scale,
      visible: true,
    };
  }

  setupListeners() {
    // Keyboard
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'KeyW'].includes(e.code)) { this.keys.ArrowUp = true; e.preventDefault(); }
      if (['ArrowDown', 'KeyS'].includes(e.code)) { this.keys.ArrowDown = true; e.preventDefault(); }
      if (['ArrowLeft', 'KeyA'].includes(e.code)) { this.keys.ArrowLeft = true; e.preventDefault(); }
      if (['ArrowRight', 'KeyD'].includes(e.code)) { this.keys.ArrowRight = true; e.preventDefault(); }
      if (e.code === 'Space') {
        if (this.servicePhase === 'ready' && this.server === 'player') {
          this.executePlayerServe();
        } else if (this.isRunning) {
          this.togglePause();
        }
        e.preventDefault();
      }
      if (['Digit1', 'Digit2', 'Digit3'].includes(e.code)) {
        const index = parseInt(e.code.replace('Digit', '')) - 1;
        this.triggerEquippedSkillByIndex(index);
      }
    });

    window.addEventListener('keyup', (e) => {
      if (['ArrowUp', 'KeyW'].includes(e.code)) this.keys.ArrowUp = false;
      if (['ArrowDown', 'KeyS'].includes(e.code)) this.keys.ArrowDown = false;
      if (['ArrowLeft', 'KeyA'].includes(e.code)) this.keys.ArrowLeft = false;
      if (['ArrowRight', 'KeyD'].includes(e.code)) this.keys.ArrowRight = false;
    });

    // Mouse Controls
    const handlePointerMove = (clientX, clientY) => {
      const rect = this.canvas.getBoundingClientRect();
      const normX = (clientX - rect.left) / rect.width;
      const normY = (clientY - rect.top) / rect.height;

      // Map screen coordinates into 3D player space
      // Lateral X: from -tableW * 0.72 to +tableW * 0.72
      const target3DX = (normX - 0.5) * (this.tableW * 1.35);
      // Vertical Y: from 5 to 110 cm
      const target3DY = Math.max(8, Math.min(125, (1 - normY) * 160));

      this.mouseInput.x = target3DX;
      this.mouseInput.y = target3DY;
      this.mouseInput.moved = true;
    };

    this.canvas.addEventListener('mousemove', (e) => {
      handlePointerMove(e.clientX, e.clientY);
    });

    this.canvas.addEventListener('mousedown', (e) => {
      this.mouseInput.isDown = true;
      if (this.servicePhase === 'ready' && this.server === 'player') {
        this.executePlayerServe();
      } else {
        this.triggerPlayerSwing();
      }
    });

    this.canvas.addEventListener('mouseup', () => {
      this.mouseInput.isDown = false;
    });

    // Touch controls for mobile / tablet
    this.canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length > 0) {
        handlePointerMove(e.touches[0].clientX, e.touches[0].clientY);
        e.preventDefault();
      }
    }, { passive: false });

    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length > 0) {
        handlePointerMove(e.touches[0].clientX, e.touches[0].clientY);
        if (this.servicePhase === 'ready' && this.server === 'player') {
          this.executePlayerServe();
        } else {
          this.triggerPlayerSwing();
        }
      }
    }, { passive: true });
  }

  // --- 15 PHASES PROGRESSIVE AI CONFIGURATION ---
  getPhaseConfig(phase) {
    const configs = {
      1: { title: 'Fase 1 — Muito fácil', aiSpeed: 300, aiLerp: 0.05, aiError: 55, spinPower: 0.05, smashRate: 0.04, desc: 'Adversário lento e com frequentes erros de devolução.' },
      2: { title: 'Fase 2 — Fácil', aiSpeed: 340, aiLerp: 0.065, aiError: 45, spinPower: 0.1, smashRate: 0.08, desc: 'Começa a devolver bolas mais consistentes.' },
      3: { title: 'Fase 3 — Fácil+', aiSpeed: 380, aiLerp: 0.08, aiError: 38, spinPower: 0.15, smashRate: 0.12, desc: 'Usa forehand e backhand com maior naturalidade.' },
      4: { title: 'Fase 4 — Normal', aiSpeed: 420, aiLerp: 0.095, aiError: 30, spinPower: 0.22, smashRate: 0.18, desc: 'Aplica topspin moderado nas trocas longas.' },
      5: { title: 'Fase 5 — Normal+', aiSpeed: 460, aiLerp: 0.11, aiError: 25, spinPower: 0.28, smashRate: 0.22, desc: 'Saques com efeito lateral e boa cobertura da mesa.' },
      6: { title: 'Fase 6 — Médio', aiSpeed: 500, aiLerp: 0.13, aiError: 20, spinPower: 0.35, smashRate: 0.28, desc: 'Devoluções rápidas e bloqueios firmes.' },
      7: { title: 'Fase 7 — Médio+', aiSpeed: 540, aiLerp: 0.15, aiError: 16, spinPower: 0.42, smashRate: 0.35, desc: 'Alterna entre topspin ofensivo e backspin defensivo.' },
      8: { title: 'Fase 8 — Difícil', aiSpeed: 590, aiLerp: 0.17, aiError: 13, spinPower: 0.5, smashRate: 0.42, desc: 'Adversário agressivo com saques profundos.' },
      9: { title: 'Fase 9 — Difícil+', aiSpeed: 640, aiLerp: 0.2, aiError: 10, spinPower: 0.58, smashRate: 0.5, desc: 'Contra-ataques imediatos em bolas mal devolvidas.' },
      10: { title: 'Fase 10 — Muito difícil', aiSpeed: 700, aiLerp: 0.23, aiError: 8, spinPower: 0.65, smashRate: 0.58, desc: 'Nível avançado com smashes rápidos e precisos.' },
      11: { title: 'Fase 11 — Extremo', aiSpeed: 760, aiLerp: 0.26, aiError: 6, spinPower: 0.72, smashRate: 0.66, desc: 'Devolve bolas com curvas agressivas de topspin.' },
      12: { title: 'Fase 12 — Extremo+', aiSpeed: 820, aiLerp: 0.3, aiError: 5, spinPower: 0.8, smashRate: 0.74, desc: 'Velocidade impressionante e tempo de reação mínimo.' },
      13: { title: 'Fase 13 — Insano', aiSpeed: 890, aiLerp: 0.34, aiError: 4, spinPower: 0.88, smashRate: 0.82, desc: 'Quase nenhum erro e saques de efeito cortado.' },
      14: { title: 'Fase 14 — Quase impossível', aiSpeed: 960, aiLerp: 0.38, aiError: 2.5, spinPower: 0.94, smashRate: 0.9, desc: 'Reflexos cirúrgicos e domínio completo da mesa.' },
      15: { title: 'Fase 15 — DESAFIO FINAL', aiSpeed: 1050, aiLerp: 0.44, aiError: 1.5, spinPower: 1.0, smashRate: 0.96, desc: 'O mestre supremo do tênis de mesa. Implacável.' },
    };
    return configs[phase] || configs[1];
  }

  startMatch(phaseNumber = 1) {
    this.currentPhase = Math.min(15, Math.max(1, phaseNumber));
    const config = this.getPhaseConfig(this.currentPhase);

    this.playerScore = 0;
    this.aiScore = 0;
    this.isGameOver = false;
    this.isPaused = false;
    this.isRunning = true;
    this.matchStartTime = Date.now();
    this.matchElapsedSeconds = 0;
    this.serviceCount = 0;
    this.server = 'player';
    this.servicePhase = 'ready';

    // AI parameters
    this.ai.speedX = config.aiSpeed;
    this.ai.lerp = config.aiLerp;
    this.ai.errorOffset = (Math.random() - 0.5) * config.aiError;
    this.ai.spinProficiency = config.spinPower;
    this.ai.smashChance = config.smashRate;

    // Reset player position
    this.player.x = 0;
    this.player.y = 40;
    this.player.z = -30;

    // Reset skills
    Object.keys(this.skillsState).forEach((key) => {
      this.skillsState[key].active = false;
      this.skillsState[key].timer = 0;
      this.skillsState[key].cooldownRemaining = 0;
    });

    this.particles = [];
    this.floatingTexts = [];
    this.lastShotFeedback = '';

    this.prepareServe();
    this.notifyScoreUpdate();
    this.notifySkillUpdate();
  }

  // Prepare a new point / serve
  prepareServe() {
    this.servicePhase = 'ready';
    this.isServeFlight = false;
    this.bouncesPlayerSide = 0;
    this.bouncesAiSide = 0;
    this.lastHitter = null;
    this.netTouchInRally = false;
    this.ball.trail = [];

    // Switch server every 2 points (standard table tennis rule)
    const totalPoints = this.playerScore + this.aiScore;
    if (this.playerScore >= 11 && this.aiScore >= 11) {
      // In deuce, server alternates every single point!
      this.server = totalPoints % 2 === 0 ? 'player' : 'ai';
    } else {
      this.server = Math.floor(totalPoints / 2) % 2 === 0 ? 'player' : 'ai';
    }

    if (this.server === 'player') {
      // Ball rests comfortably in front of player over the baseline ready to be served
      this.ball.x = Math.max(-this.tableW * 0.35, Math.min(this.tableW * 0.35, this.player.x + 10));
      this.ball.y = 44;
      this.ball.z = 25;
      this.ball.vx = 0;
      this.ball.vy = 0;
      this.ball.vz = 0;
      this.ball.spinX = 0;
      this.ball.spinY = 0;
      this.addFloatingText(this.width / 2, this.height / 2 - 80, 'SEU SAQUE! [CLIQUE OU ESPAÇO]', '#00f5d4');
    } else {
      // AI Serve ready position
      const aiStartX = (Math.random() - 0.5) * (this.tableW * 0.5);
      this.ball.x = aiStartX;
      this.ball.y = 44;
      this.ball.z = this.tableL - 25;
      this.ball.vx = 0;
      this.ball.vy = 0;
      this.ball.vz = 0;
      this.ball.spinX = 0;
      this.ball.spinY = 0;
      this.addFloatingText(this.width / 2, this.height / 2 - 80, 'SAQUE DO ADVERSÁRIO...', '#ffd166');

      // AI serves after a short natural delay
      setTimeout(() => {
        if (this.isRunning && this.servicePhase === 'ready' && this.server === 'ai') {
          this.executeAiServe();
        }
      }, 1100);
    }
  }

  executePlayerServe() {
    if (this.servicePhase !== 'ready' || this.server !== 'player') return;
    this.servicePhase = 'in_play';
    this.isServeFlight = true;
    this.lastHitter = 'player';
    this.bouncesPlayerSide = 0;
    this.bouncesAiSide = 0;

    // Realistic table tennis serve:
    // Stroke bounces first on server's table half (z ≈ 115), arcs cleanly over the net, and lands on opponent side
    const dirX = (this.player.x / (this.tableW / 2)) * 60 + (Math.random() - 0.5) * 30;
    this.ball.vx = dirX;
    this.ball.vy = -80; // gently directs ball to bounce on player's half
    this.ball.vz = 540;  // moves forward with controlled pace
    this.ball.spinX = 18; // smooth topspin

    this.player.swingProgress = 1;
    this.player.swingType = 'drive';
    this.createImpactParticles3D(this.ball.x, this.ball.y, this.ball.z, '#00f2fe', 14);
    if (window.soundEngine) window.soundEngine.playPaddleHit(1.2);
  }

  executeAiServe() {
    if (this.servicePhase !== 'ready' || this.server !== 'ai') return;
    this.servicePhase = 'in_play';
    this.isServeFlight = true;
    this.lastHitter = 'ai';
    this.bouncesPlayerSide = 0;
    this.bouncesAiSide = 0;

    const config = this.getPhaseConfig(this.currentPhase);
    const targetX = (Math.random() - 0.5) * (this.tableW * 0.6);

    this.ball.vx = (targetX - this.ball.x) * 1.5;
    this.ball.vy = -80; // bounces on AI side first
    this.ball.vz = -540; // moves toward player
    this.ball.spinX = config.spinPower * 20;

    this.ai.swingProgress = 1;
    this.ai.swingType = 'drive';
    this.createImpactParticles3D(this.ball.x, this.ball.y, this.ball.z, '#ff0054', 14);
    if (window.soundEngine) window.soundEngine.playPaddleHit(0.9);
  }

  triggerPlayerSwing() {
    this.player.swingProgress = 1;
  }

  togglePause() {
    if (this.isGameOver) return;
    this.isPaused = !this.isPaused;
  }

  triggerEquippedSkillByIndex(slotIndex) {
    const user = window.storageEngine?.getCurrentUser();
    if (!user || !user.equipped || !user.equipped.skills) return;
    const skillId = user.equipped.skills[slotIndex];
    if (skillId) this.activateSkill(skillId);
  }

  activateSkill(skillId) {
    if (!this.isRunning || this.isPaused) return;
    const skill = this.skillsState[skillId];
    if (!skill || skill.cooldownRemaining > 0 || skill.active) return;

    const catalogItem = window.storageEngine?.getCatalog().find((i) => i.id === skillId);
    if (!catalogItem) return;

    if (window.soundEngine) window.soundEngine.playSkill(skillId.replace('skill_', ''));

    skill.active = true;
    skill.timer = catalogItem.duration || 4;
    skill.cooldownRemaining = catalogItem.cooldown || 12;
    skill.cooldownMax = catalogItem.cooldown || 12;

    if (skillId === 'skill_shield') {
      skill.hitsLeft = 1;
      this.addFloatingText(this.width / 2, this.height / 2, '🛡️ ESCUDO ATIVADO!', '#00f5d4');
    } else if (skillId === 'skill_smash') {
      skill.charged = true;
      this.addFloatingText(this.width / 2, this.height / 2, '🔥 SMASH CARREGADO!', '#ff5400');
    } else if (skillId === 'skill_precision') {
      this.player.reach = 85;
      this.addFloatingText(this.width / 2, this.height / 2, '🎯 PRECISÃO +50%!', '#c77dff');
    } else if (skillId === 'skill_speed') {
      this.addFloatingText(this.width / 2, this.height / 2, '⚡ VELOCIDADE +60%!', '#ffd166');
    } else if (skillId === 'skill_freeze') {
      this.ball.vx *= 0.45;
      this.ball.vy *= 0.45;
      this.ball.vz *= 0.45;
      this.addFloatingText(this.width / 2, this.height / 2, '❄️ FREEZE!', '#4cc9f0');
    } else if (skillId === 'skill_turbo') {
      this.addFloatingText(this.width / 2, this.height / 2, '⚡ TURBO SUPREMO!', '#f72585');
    }

    this.notifySkillUpdate();
  }

  // --- GAME LOOP & PHYSICS UPDATE ---
  loop(timestamp) {
    const dt = 1 / 60;
    if (this.isRunning && !this.isPaused && !this.isGameOver) {
      this.update(dt);
    }
    this.render();
    requestAnimationFrame(this.loop);
  }

  update(dt) {
    this.matchElapsedSeconds = (Date.now() - this.matchStartTime) / 1000;

    // Update active skills cooldowns
    Object.keys(this.skillsState).forEach((key) => {
      const s = this.skillsState[key];
      if (s.active && s.timer > 0) {
        s.timer -= dt;
        if (s.timer <= 0) {
          s.active = false;
          if (key === 'skill_precision') this.player.reach = 55;
        }
      }
      if (s.cooldownRemaining > 0) {
        s.cooldownRemaining = Math.max(0, s.cooldownRemaining - dt);
        if (s.cooldownRemaining === 0) this.notifySkillUpdate();
      }
    });

    // 1. Update Player Paddle position & posture
    this.updatePlayerPaddle(dt);

    // 2. Update AI Paddle position & state
    this.updateAiPaddle(dt);

    // 3. Update Ball 3D Physics
    if (this.servicePhase === 'in_play') {
      this.updateBallPhysics(dt);
    }

    // 4. Update Visual Particles & Screen Shake
    if (this.screenshake > 0) {
      this.screenshake *= 0.86;
      if (this.screenshake < 0.2) this.screenshake = 0;
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.alpha -= p.decay * dt;
      if (p.alpha <= 0) this.particles.splice(i, 1);
    }

    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y -= 35 * dt;
      ft.alpha -= 0.6 * dt;
      if (ft.alpha <= 0) this.floatingTexts.splice(i, 1);
    }
  }

  updatePlayerPaddle(dt) {
    this.player.prevX = this.player.x;
    this.player.prevY = this.player.y;

    let moveSpeed = 650;
    if (this.skillsState.skill_speed.active) moveSpeed *= 1.6;
    if (this.skillsState.skill_turbo.active) moveSpeed *= 1.8;

    if (this.mouseInput.moved) {
      // Direct smooth tracking to mouse position
      const diffX = this.mouseInput.x - this.player.x;
      const diffY = this.mouseInput.y - this.player.y;
      this.player.x += diffX * 0.35;
      this.player.y += diffY * 0.35;
    } else {
      if (this.keys.ArrowLeft) this.player.x -= moveSpeed * dt;
      if (this.keys.ArrowRight) this.player.x += moveSpeed * dt;
      if (this.keys.ArrowUp) this.player.y += moveSpeed * dt;
      if (this.keys.ArrowDown) this.player.y -= moveSpeed * dt;
    }

    // Clamp inside realistic player range
    this.player.x = Math.max(-this.tableW * 0.75, Math.min(this.tableW * 0.75, this.player.x));
    this.player.y = Math.max(5, Math.min(130, this.player.y));

    // Player velocity (for imparting speed & spin)
    this.player.vx = (this.player.x - this.player.prevX) / dt;
    this.player.vy = (this.player.y - this.player.prevY) / dt;

    // Forehand / Backhand detection based on body side
    this.player.isForehand = this.player.x >= 0;

    // Swing recovery decay
    if (this.player.swingProgress > 0) {
      this.player.swingProgress = Math.max(0, this.player.swingProgress - dt * 3.5);
    }
  }

  updateAiPaddle(dt) {
    const config = this.getPhaseConfig(this.currentPhase);

    // AI tracks ball when moving toward AI side (vz > 0)
    if (this.ball.vz > 0) {
      this.ai.targetX = this.ball.x + this.ai.errorOffset;
      this.ai.targetY = Math.max(10, Math.min(110, this.ball.y));
    } else {
      // Return to tactical center
      this.ai.targetX = 0;
      this.ai.targetY = 45;
    }

    const diffX = this.ai.targetX - this.ai.x;
    const diffY = this.ai.targetY - this.ai.y;

    const stepX = Math.sign(diffX) * Math.min(Math.abs(diffX), this.ai.speedX * dt);
    const stepY = Math.sign(diffY) * Math.min(Math.abs(diffY), this.ai.speedY * dt);

    this.ai.x += stepX;
    this.ai.y += stepY;

    this.ai.isForehand = this.ai.x < 0; // mirrored

    if (this.ai.swingProgress > 0) {
      this.ai.swingProgress = Math.max(0, this.ai.swingProgress - dt * 3.5);
    }

    // AI Paddle Hit detection (when ball reaches opponent baseline z ~ tableL)
    if (
      this.servicePhase === 'in_play' &&
      this.ball.vz > 0 &&
      this.ball.z >= this.tableL - 10 &&
      this.ball.z <= this.tableL + 40
    ) {
      const dist = Math.hypot(this.ball.x - this.ai.x, this.ball.y - this.ai.y);
      if (dist <= 65) {
        this.handleAiReturn();
      }
    }
  }

  updateBallPhysics(dt) {
    const prevX = this.ball.x;
    const prevY = this.ball.y;
    const prevZ = this.ball.z;

    // 1. Gravity and Magnus spin effect
    // Topspin (spinX > 0) causes downward aerodynamic curve
    // Backspin (spinX < 0) causes upward floating aerodynamic lift
    // Sidespin (spinY) creates lateral curve arc
    const magnusY = -this.ball.spinX * 3.8;
    const magnusX = this.ball.spinY * 3.2;

    this.ball.vy += (-this.gravity + magnusY) * dt;
    this.ball.vx += magnusX * dt;

    this.ball.x += this.ball.vx * dt;
    this.ball.y += this.ball.vy * dt;
    this.ball.z += this.ball.vz * dt;

    // Trail
    this.ball.trail.push({ x: this.ball.x, y: this.ball.y, z: this.ball.z, alpha: 0.9 });
    if (this.ball.trail.length > 14) this.ball.trail.shift();
    this.ball.trail.forEach((t) => (t.alpha *= 0.88));

    // 2. Continuous Table Bounce Collision (y = 0 plane)
    // Check if the ball crossed the y = 0 plane during this integration step
    const crossedTablePlane = (prevY >= -4 && this.ball.y <= 2 && (prevY > 0 || this.ball.y <= 0));

    if (crossedTablePlane) {
      const dy = prevY - this.ball.y;
      const t = dy !== 0 ? Math.max(0, Math.min(1, prevY / dy)) : 0.5;
      const crossX = prevX + (this.ball.x - prevX) * t;
      const crossZ = prevZ + (this.ball.z - prevZ) * t;

      // Generous table boundary edge tolerance so curving shots bounce reliably
      const halfW = this.tableW / 2 + 14;
      const isWithinTableX = Math.abs(crossX) <= halfW;
      const isWithinTableZ = crossZ >= -10 && crossZ <= this.tableL + 15;

      if (isWithinTableX && isWithinTableZ) {
        this.ball.y = 0;
        this.ball.x = crossX;
        this.ball.z = crossZ;

        // Realistic Table Tennis Serve Arc:
        if (this.isServeFlight) {
          if (this.server === 'player') {
            if (this.ball.z < this.netZ && this.bouncesPlayerSide === 0) {
              // First bounce on player's half: arc smoothly upward to easily clear the net!
              this.ball.vy = 340;
            } else {
              // Ball reached receiver's half!
              this.ball.vy = Math.abs(this.ball.vy) * 0.82;
              this.isServeFlight = false;
            }
          } else if (this.server === 'ai') {
            if (this.ball.z > this.netZ && this.bouncesAiSide === 0) {
              // First bounce on AI half: arc smoothly upward to easily clear the net!
              this.ball.vy = 340;
            } else {
              // Ball reached player's half!
              this.ball.vy = Math.abs(this.ball.vy) * 0.82;
              this.isServeFlight = false;
            }
          }
        } else {
          this.ball.vy = Math.abs(this.ball.vy) * 0.84; // standard table restitution
        }

        // Spin effect on bounce:
        // Topspin increases forward speed (vz)
        // Backspin brakes forward speed (vz)
        if (this.ball.spinX > 0) {
          this.ball.vz += Math.sign(this.ball.vz) * (this.ball.spinX * 0.35);
          this.ball.spinX *= 0.6; // spin transferred
        } else if (this.ball.spinX < 0) {
          this.ball.vz *= 0.86;
          this.ball.spinX *= 0.6;
        }

        // Slight sidespin transfer into lateral bounce kick
        this.ball.vx += this.ball.spinY * 1.4;
        this.ball.spinY *= 0.7;

        // Check which side of table the bounce occurred
        if (this.ball.z < this.netZ) {
          this.bouncesPlayerSide++;
        } else {
          this.bouncesAiSide++;
        }

        // Visuals & Sound for bounce
        this.createImpactParticles3D(this.ball.x, 0, this.ball.z, '#ffffff', 8);
        if (window.soundEngine) window.soundEngine.playWallHit();

        // Check illegal double bounce
        if (this.bouncesPlayerSide >= 2) {
          this.awardPoint('ai', 'Dois quiques no campo do jogador!');
          return;
        }
        if (this.bouncesAiSide >= 2) {
          this.awardPoint('player', 'Dois quiques no campo do adversário!');
          return;
        }
      }
    }

    // 3. Net Collision (z = netZ, y <= netH)
    if (Math.abs(this.ball.z - this.netZ) <= 8 && this.ball.y <= this.netH) {
      if (Math.abs(this.ball.x) <= this.tableW / 2 + 15) {
        // If ball is in serve flight and already high enough, ensure it glides over without stopping
        if (this.isServeFlight && this.ball.y > 24) {
          this.ball.vy = Math.max(this.ball.vy, 40);
        } else {
          // Ball clips the net
          this.netTouchInRally = true;
          this.ball.vz = -this.ball.vz * 0.35;
          this.ball.vy *= 0.5;
          this.createImpactParticles3D(this.ball.x, this.ball.y, this.netZ, '#00f5d4', 10);
          if (window.soundEngine) window.soundEngine.playWallHit();
        }
      }
    }

    // 4. Player Paddle Hit Detection (when ball approaches z ~ 0)
    if (
      this.ball.vz < 0 &&
      this.ball.z <= this.player.z + 28 &&
      this.ball.z >= this.player.z - 40
    ) {
      const dist = Math.hypot(this.ball.x - this.player.x, this.ball.y - this.player.y);
      if (dist <= this.player.reach) {
        this.handlePlayerReturn();
        return;
      }
    }

    // 5. Out of bounds detection (ball fell past players or off table)
    if (this.ball.y < -70 || this.ball.z < -100 || this.ball.z > this.tableL + 120) {
      this.evaluateOutOfBounds();
    }
  }

  handlePlayerReturn() {
    this.isServeFlight = false;
    this.lastHitter = 'player';
    this.bouncesPlayerSide = 0;
    this.bouncesAiSide = 0;
    this.rallyLength++;

    // Calculate shot type based on paddle vertical movement and position
    let shotType = 'drive';
    let spinVal = 14;
    let forwardSpeed = 640;
    let verticalSpeed = 245;

    if (this.skillsState.skill_smash.charged) {
      // Active Smash Skill
      shotType = 'smash';
      forwardSpeed = 980;
      verticalSpeed = 190;
      spinVal = 40;
      this.skillsState.skill_smash.charged = false;
      this.skillsState.skill_smash.active = false;
      this.screenshake = 18;
      this.addFloatingText(this.width / 2, this.height / 2 - 40, '🔥 SUPER SMASH!', '#ff0054');
    } else if (this.player.vy > 120) {
      // Quick upward stroke: TOPSPIN!
      shotType = 'topspin';
      forwardSpeed = 740;
      verticalSpeed = 275;
      spinVal = 35;
      this.addFloatingText(this.width / 2, this.height / 2 - 40, 'TOPSPIN!', '#00f2fe');
    } else if (this.player.vy < -100) {
      // Chopping downward stroke: BACKSPIN!
      shotType = 'backspin';
      forwardSpeed = 540;
      verticalSpeed = 220;
      spinVal = -28;
      this.addFloatingText(this.width / 2, this.height / 2 - 40, 'BACKSPIN!', '#ffd166');
    } else if (Math.abs(this.ball.vz) > 750) {
      // Defensive block against aggressive fast ball
      shotType = 'block';
      forwardSpeed = 580;
      verticalSpeed = 220;
      spinVal = 5;
      this.addFloatingText(this.width / 2, this.height / 2 - 40, 'BLOCK!', '#00f5d4');
    } else {
      shotType = this.player.isForehand ? 'Forehand Drive' : 'Backhand Drive';
      forwardSpeed = 640;
      verticalSpeed = 245;
      spinVal = 14;
    }

    // Directional control and Sidespin / Curve:
    // offsetRatio: -1 (left edge of paddle) to +1 (right edge of paddle)
    const offsetRatio = Math.max(-1, Math.min(1, (this.ball.x - this.player.x) / this.player.reach));
    // Player lateral paddle swipe brush (from mouse or keys velocity)
    const brushVelocity = Math.max(-450, Math.min(450, this.player.vx));
    const brushRatio = brushVelocity / 450;

    // Sidespin (curve) imparted: combined paddle contact offset + brushing swipe motion
    const spinY = (offsetRatio * 16) + (brushRatio * 20);

    // Aim target on opponent's table: safely inside opponent court [-tableW * 0.42, +tableW * 0.42]
    const targetX = Math.max(
      -this.tableW * 0.42,
      Math.min(this.tableW * 0.42, (offsetRatio * 0.65 + brushRatio * 0.35) * (this.tableW * 0.42))
    );

    // Estimated flight time to opponent baseline
    const flightTime = Math.max(0.35, (this.tableL - this.ball.z) / forwardSpeed);

    // Initial lateral velocity vx: compensate for Magnus curve acceleration (spinY * 3.2)
    // so that curved shots bend gracefully through the air AND land on the table!
    const magnusAx = spinY * 3.2;
    const requiredVx = (targetX - this.ball.x) / flightTime - 0.5 * magnusAx * flightTime;

    this.ball.vx = Math.max(-340, Math.min(340, requiredVx));
    this.ball.vy = verticalSpeed;
    this.ball.vz = forwardSpeed;
    this.ball.spinX = spinVal;
    this.ball.spinY = spinY;

    if (Math.abs(spinY) > 10) {
      this.addFloatingText(this.width / 2, this.height / 2 - 25, '🔄 CURVA COM EFEITO!', '#c084fc');
    }

    this.player.swingProgress = 1;
    this.player.swingType = shotType;

    const user = window.storageEngine?.getCurrentUser();
    const racketId = user?.equipped?.racket || 'racket_classic';
    const racketItem = window.storageEngine?.getCatalog().find((i) => i.id === racketId);
    const hitColor = racketItem?.color || '#00f2fe';

    this.createImpactParticles3D(this.ball.x, this.ball.y, this.ball.z, hitColor, 16);
    if (window.soundEngine) window.soundEngine.playPaddleHit(1.1);
  }

  handleAiReturn() {
    this.isServeFlight = false;
    this.lastHitter = 'ai';
    this.bouncesPlayerSide = 0;
    this.bouncesAiSide = 0;
    this.rallyLength++;

    const config = this.getPhaseConfig(this.currentPhase);

    // AI shot selection
    let shotType = 'drive';
    let spinVal = 10;
    let forwardSpeed = 600 + this.currentPhase * 18;
    let verticalSpeed = 235;

    const willSmash = Math.random() < this.ai.smashChance && this.ball.y > 50;
    const willTopspin = Math.random() < 0.65;

    if (willSmash) {
      shotType = 'smash';
      forwardSpeed = 880 + this.currentPhase * 16;
      verticalSpeed = 180;
      spinVal = 30;
      this.screenshake = 14;
      this.addFloatingText(this.width / 2, this.height / 2 - 40, '⚡ ATAQUE DO ADVERSÁRIO!', '#ff0054');
    } else if (willTopspin) {
      shotType = 'topspin';
      forwardSpeed = 680 + this.currentPhase * 18;
      verticalSpeed = 265;
      spinVal = this.ai.spinProficiency * 35;
    } else {
      shotType = 'backspin';
      forwardSpeed = 540 + this.currentPhase * 14;
      verticalSpeed = 215;
      spinVal = -this.ai.spinProficiency * 25;
    }

    // Aim toward corners or away from player
    const targetX = (Math.random() > 0.5 ? 1 : -1) * (this.tableW * (0.25 + Math.random() * 0.2));
    const lateralSpeed = (targetX - this.ball.x) * 1.5;

    this.ball.vx = lateralSpeed;
    this.ball.vy = verticalSpeed;
    this.ball.vz = -forwardSpeed; // moves toward player
    this.ball.spinX = spinVal;
    this.ball.spinY = (Math.random() - 0.5) * 15;

    this.ai.swingProgress = 1;
    this.ai.swingType = shotType;

    this.createImpactParticles3D(this.ball.x, this.ball.y, this.ball.z, '#ff0054', 16);
    if (window.soundEngine) window.soundEngine.playPaddleHit(0.9);
  }

  evaluateOutOfBounds() {
    if (this.servicePhase !== 'in_play') return;

    // Check Shield barrier skill (saves ball if player missed)
    if (
      this.skillsState.skill_shield.active &&
      this.skillsState.skill_shield.hitsLeft > 0 &&
      this.lastHitter === 'ai' &&
      this.ball.z < 0
    ) {
      this.skillsState.skill_shield.hitsLeft = 0;
      this.skillsState.skill_shield.active = false;
      this.ball.vz = 650;
      this.ball.vy = 240;
      this.createImpactParticles3D(this.ball.x, this.ball.y, 0, '#00f5d4', 25);
      this.addFloatingText(this.width / 2, this.height / 2 - 40, '🛡️ DEFESA AUTOMÁTICA!', '#00f5d4');
      if (window.soundEngine) window.soundEngine.playSkill('shield');
      return;
    }

    // Table Tennis Scoring Rules:
    // If player hit last:
    //   - If it bounced 0 times on opponent side: Player hit out! AI scores.
    //   - If it bounced 1 time on opponent side and AI didn't return: Player scores!
    // If AI hit last:
    //   - If it bounced 0 times on player side: AI hit out! Player scores.
    //   - If it bounced 1 time on player side and player didn't return: AI scores.
    if (this.lastHitter === 'player') {
      if (this.bouncesAiSide >= 1) {
        this.awardPoint('player', 'Ponto do Jogador!');
      } else {
        this.awardPoint('ai', 'Bola fora!');
      }
    } else if (this.lastHitter === 'ai') {
      if (this.bouncesPlayerSide >= 1) {
        this.awardPoint('ai', 'Ponto do Adversário!');
      } else {
        this.awardPoint('player', 'Adversário jogou fora!');
      }
    } else {
      this.prepareServe();
    }
  }

  awardPoint(winner, reason = '') {
    this.servicePhase = 'point_awarded';

    if (winner === 'player') {
      this.playerScore++;
      this.screenshake = 10;
      this.addFloatingText(this.width / 2, this.height / 2 - 50, `+1 PONTO! (${reason})`, '#00f5d4');
      if (window.soundEngine) window.soundEngine.playScore(true);
    } else {
      this.aiScore++;
      this.screenshake = 12;
      this.addFloatingText(this.width / 2, this.height / 2 - 50, `PONTO ADVERSÁRIO (${reason})`, '#ff0054');
      if (window.soundEngine) window.soundEngine.playScore(false);
    }

    this.notifyScoreUpdate();
    this.checkMatchEnd();
  }

  checkMatchEnd() {
    // Rule 2 & Rule 26: Must reach >= 12 points AND have at least 2 points lead
    const isPlayerWin = this.playerScore >= this.minPointsToWin && (this.playerScore - this.aiScore) >= this.minLead;
    const isAiWin = this.aiScore >= this.minPointsToWin && (this.aiScore - this.playerScore) >= this.minLead;

    if (isPlayerWin) {
      this.isGameOver = true;
      this.isRunning = false;
      if (window.soundEngine) window.soundEngine.playPhaseWin();

      const duration = Math.round(this.matchElapsedSeconds);

      setTimeout(() => {
        if (this.onPhaseWin) {
          this.onPhaseWin({
            phase: this.currentPhase,
            playerScore: this.playerScore,
            opponentScore: this.aiScore,
            duration,
          });
        }
      }, 800);
    } else if (isAiWin) {
      this.isGameOver = true;
      this.isRunning = false;
      if (window.soundEngine) window.soundEngine.playGameOver();

      const duration = Math.round(this.matchElapsedSeconds);

      setTimeout(() => {
        if (this.onPhaseLose) {
          this.onPhaseLose({
            phase: this.currentPhase,
            playerScore: this.playerScore,
            opponentScore: this.aiScore,
            duration,
          });
        }
      }, 800);
    } else {
      // Continue next serve after point celebration
      setTimeout(() => {
        if (this.isRunning && !this.isGameOver) {
          this.prepareServe();
        }
      }, 1100);
    }
  }

  notifyScoreUpdate() {
    if (this.onScoreUpdate) {
      const isDeuce = this.playerScore >= 11 && this.aiScore >= 11 && this.playerScore === this.aiScore;
      const playerAdvantage = this.playerScore >= 11 && this.aiScore >= 11 && (this.playerScore - this.aiScore === 1);
      const aiAdvantage = this.playerScore >= 11 && this.aiScore >= 11 && (this.aiScore - this.playerScore === 1);

      this.onScoreUpdate({
        playerScore: this.playerScore,
        aiScore: this.aiScore,
        currentPhase: this.currentPhase,
        minPointsToWin: this.minPointsToWin,
        minLead: this.minLead,
        isDeuce,
        playerAdvantage,
        aiAdvantage,
        server: this.server,
      });
    }
  }

  notifySkillUpdate() {
    if (this.onSkillUpdate) {
      this.onSkillUpdate(this.skillsState);
    }
  }

  createImpactParticles3D(x, y, z, color, count = 12) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 120 + 40;
      this.particles.push({
        x,
        y,
        z,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed + 50,
        vz: (Math.random() - 0.5) * speed,
        color,
        size: Math.random() * 3 + 1.5,
        alpha: 1,
        decay: Math.random() * 1.5 + 1.0,
      });
    }
  }

  addFloatingText(x, y, text, color = '#ffd166') {
    this.floatingTexts.push({ x, y, text, color, alpha: 1 });
  }

  // ==========================================================================
  // 3D RENDERING PIPELINE (OFFICIAL TABLE, NET, RACKETS, BALL SHADOW, PARTICLES)
  // ==========================================================================
  render() {
    this.ctx.save();

    if (this.screenshake > 0) {
      this.ctx.translate(
        (Math.random() - 0.5) * this.screenshake,
        (Math.random() - 0.5) * this.screenshake
      );
    }

    // 1. Draw Sports Arena Backdrop & Floor
    this.renderArenaBackground();

    // 2. Draw 3D Table Tennis Table (legs, surface, lines, specular)
    this.render3DTable();

    // 3. Draw AI Paddle & Shadow (far side of table)
    this.renderPaddleShadow(this.ai.x, this.ai.y, this.ai.z, false);
    this.renderAiRacket();

    // 4. Draw Official Net in center
    this.render3DNet();

    // 5. Draw Ball Shadow on Table Surface
    this.renderBallShadow();

    // 6. Draw 3D Table Tennis Ball & Trail
    this.render3DBall();

    // 7. Draw Player Paddle & Shadow in foreground
    this.renderPaddleShadow(this.player.x, this.player.y, this.player.z, true);
    this.renderPlayerRacket();

    // 8. Draw 3D Particles
    this.render3DParticles();

    // 9. In-Game Overlays (Deuce, Pause, Service hints)
    this.renderOverlays();

    this.ctx.restore();
  }

  renderArenaBackground() {
    const user = window.storageEngine?.getCurrentUser();
    const tableId = user?.equipped?.table || 'table_classic';
    const tableItem = window.storageEngine?.getCatalog().find((i) => i.id === tableId);
    const theme = tableItem?.theme || 'classic';

    // 1. Stadium Ceiling & Upper Atmosphere
    const ceilingGrad = this.ctx.createLinearGradient(0, 0, 0, this.cam.horizonY);
    if (theme === 'neon' || theme === 'cyber') {
      ceilingGrad.addColorStop(0, '#02050e');
      ceilingGrad.addColorStop(0.5, '#071126');
      ceilingGrad.addColorStop(1, '#030814');
    } else if (theme === 'lava') {
      ceilingGrad.addColorStop(0, '#100202');
      ceilingGrad.addColorStop(0.5, '#200707');
      ceilingGrad.addColorStop(1, '#090202');
    } else {
      ceilingGrad.addColorStop(0, '#030712');
      ceilingGrad.addColorStop(0.5, '#0b162c');
      ceilingGrad.addColorStop(1, '#060d1b');
    }
    this.ctx.fillStyle = ceilingGrad;
    this.ctx.fillRect(0, 0, this.width, this.height);

    // 2. Steel Arena Trusses & Roof Girders
    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    this.ctx.lineWidth = 1.5;
    for (let tx = 80; tx < this.width; tx += 160) {
      this.ctx.beginPath();
      this.ctx.moveTo(tx, 0);
      this.ctx.lineTo(tx, 130);
      this.ctx.lineTo(tx + 80, 0);
      this.ctx.stroke();
    }
    this.ctx.restore();

    // 3. Realistic Bleachers / Arquibancadas with Audience (Tiers 1, 2, 3, 4)
    const bleacherTopY = 45;
    const bleacherBotY = 230;
    const rows = 9;
    const rowHeight = (bleacherBotY - bleacherTopY) / rows;

    // Crowd Palette (realistic spectator clothing)
    const crowdShirts = [
      '#dc2626', '#2563eb', '#16a34a', '#eab308', '#9333ea',
      '#0d9488', '#ea580c', '#ffffff', '#475569', '#38bdf8'
    ];
    const crowdFaces = ['#fbcfe8', '#fed7aa', '#fde047', '#fecdd3', '#d97706', '#92400e'];

    // Draw stepped concrete tiers and spectators
    for (let r = 0; r < rows; r++) {
      const rowY = bleacherTopY + r * rowHeight;
      const rowScale = 0.65 + (r / rows) * 0.35; // perspective depth

      // Concrete tier step
      this.ctx.fillStyle = r % 2 === 0 ? 'rgba(15, 23, 42, 0.95)' : 'rgba(30, 41, 59, 0.9)';
      this.ctx.fillRect(0, rowY, this.width, rowHeight);

      // Tier shadow line
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      this.ctx.fillRect(0, rowY + rowHeight - 2, this.width, 2);

      // Spectators along this row
      const stepWidth = 16 * rowScale;
      for (let sx = 10; sx < this.width - 10; sx += stepWidth + 2) {
        // Pseudo-random deterministic spectator appearance
        const seed = Math.sin(sx * 12.3 + r * 45.7);
        if (seed > -0.85) { // 90% seat occupancy
          const shirtColor = crowdShirts[Math.abs(Math.floor(seed * 100)) % crowdShirts.length];
          const faceColor = crowdFaces[Math.abs(Math.floor(seed * 77)) % crowdFaces.length];

          const headRadius = 3.5 * rowScale;
          const bodyW = 9 * rowScale;
          const bodyH = 8 * rowScale;
          const bodyY = rowY + rowHeight - bodyH;
          const headY = bodyY - headRadius;

          // Body / Torso
          this.ctx.fillStyle = shirtColor;
          this.ctx.beginPath();
          this.ctx.roundRect ? this.ctx.roundRect(sx, bodyY, bodyW, bodyH, 2) : this.ctx.rect(sx, bodyY, bodyW, bodyH);
          this.ctx.fill();

          // Head
          this.ctx.fillStyle = faceColor;
          this.ctx.beginPath();
          this.ctx.arc(sx + bodyW / 2, headY, headRadius, 0, Math.PI * 2);
          this.ctx.fill();

          // Hair / Cap
          this.ctx.fillStyle = seed > 0 ? '#1e293b' : '#78350f';
          this.ctx.beginPath();
          this.ctx.arc(sx + bodyW / 2, headY - 1, headRadius * 0.85, Math.PI, Math.PI * 2);
          this.ctx.fill();
        }
      }
    }

    // 4. Dynamic Camera Flashes in Grandstands (realistic Olympic atmosphere!)
    this.ctx.save();
    if (Math.random() < 0.12) {
      const flashX = Math.random() * (this.width - 80) + 40;
      const flashY = Math.random() * (bleacherBotY - bleacherTopY) + bleacherTopY;
      const flashR = Math.random() * 12 + 6;

      const flashGrad = this.ctx.createRadialGradient(flashX, flashY, 1, flashX, flashY, flashR);
      flashGrad.addColorStop(0, '#ffffff');
      flashGrad.addColorStop(0.3, 'rgba(255, 255, 255, 0.8)');
      flashGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');

      this.ctx.fillStyle = flashGrad;
      this.ctx.beginPath();
      this.ctx.arc(flashX, flashY, flashR, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.restore();

    // 5. Overhead Stadium Floodlights (conical soft light beams onto the table)
    const lights = [
      { x: 140, y: 15, targetX: this.width * 0.35, targetY: this.height * 0.75 },
      { x: 400, y: 10, targetX: this.width * 0.48, targetY: this.height * 0.7 },
      { x: 700, y: 10, targetX: this.width * 0.52, targetY: this.height * 0.7 },
      { x: 960, y: 15, targetX: this.width * 0.65, targetY: this.height * 0.75 },
    ];

    lights.forEach((l) => {
      // Light housing
      this.ctx.fillStyle = '#cbd5e1';
      this.ctx.fillRect(l.x - 16, l.y - 4, 32, 10);

      // Light beam
      const beamGrad = this.ctx.createRadialGradient(l.x, l.y, 10, l.targetX, l.targetY, 420);
      beamGrad.addColorStop(0, 'rgba(255, 255, 255, 0.12)');
      beamGrad.addColorStop(0.5, 'rgba(0, 242, 254, 0.04)');
      beamGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      this.ctx.fillStyle = beamGrad;
      this.ctx.beginPath();
      this.ctx.moveTo(l.x - 14, l.y + 6);
      this.ctx.lineTo(l.targetX + 160, l.targetY);
      this.ctx.lineTo(l.targetX - 160, l.targetY);
      this.ctx.closePath();
      this.ctx.fill();
    });

    // 6. Tournament LED Perimeter Banners (Apara-Bolas / Court Enclosure)
    const barrierY = bleacherBotY + 2;
    const barrierH = 34;
    this.ctx.fillStyle = '#0b162a';
    this.ctx.fillRect(0, barrierY, this.width, barrierH);

    // Glowing LED Banner Trim
    this.ctx.fillStyle = '#00f2fe';
    this.ctx.shadowColor = '#00f2fe';
    this.ctx.shadowBlur = 8;
    this.ctx.fillRect(0, barrierY, this.width, 2.5);

    // Digital Sponsor Typography across barrier
    this.ctx.save();
    this.ctx.font = '700 11px "Orbitron", sans-serif';
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('🏓 WORLD TABLE TENNIS CHAMPIONSHIP  •  15 CHALLENGE  •  ITTF PRO ARENA', this.width / 2, barrierY + 21);
    this.ctx.restore();

    // 7. Olympic Taraflex Tournament Floor (Rubber Mat & Court Perspective)
    const floorY = barrierY + barrierH;
    const floorGrad = this.ctx.createLinearGradient(0, floorY, 0, this.height);
    if (theme === 'neon') {
      floorGrad.addColorStop(0, '#040b17');
      floorGrad.addColorStop(1, '#061326');
    } else if (theme === 'cyber') {
      floorGrad.addColorStop(0, '#0d041c');
      floorGrad.addColorStop(1, '#1b0838');
    } else if (theme === 'lava') {
      floorGrad.addColorStop(0, '#130404');
      floorGrad.addColorStop(1, '#240808');
    } else {
      // Official Olympic Red/Navy Taraflex Floor
      floorGrad.addColorStop(0, '#081324');
      floorGrad.addColorStop(0.4, '#0e223d');
      floorGrad.addColorStop(1, '#060d1b');
    }
    this.ctx.fillStyle = floorGrad;
    this.ctx.fillRect(0, floorY, this.width, this.height - floorY);

    // Court boundary lines in perspective
    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    this.ctx.lineWidth = 1.5;
    const floorSteps = 12;
    for (let i = -floorSteps; i <= floorSteps; i++) {
      const p1 = this.project3D(i * 110, -110, -120);
      const p2 = this.project3D(i * 140, -110, this.tableL + 250);
      if (p1.visible && p2.visible) {
        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.lineTo(p2.x, p2.y);
        this.ctx.stroke();
      }
    }
    this.ctx.restore();
  }

  render3DTable() {
    const user = window.storageEngine?.getCurrentUser();
    const tableId = user?.equipped?.table || 'table_classic';
    const tableItem = window.storageEngine?.getCatalog().find((i) => i.id === tableId);
    const theme = tableItem?.theme || 'classic';

    const halfW = this.tableW / 2;
    const len = this.tableL;

    // 4 Corners of table surface in 3D:
    // Bottom-Left (near player):  (-halfW, 0, 0)
    // Bottom-Right (near player): (+halfW, 0, 0)
    // Top-Right (near opponent):  (+halfW, 0, len)
    // Top-Left (near opponent):   (-halfW, 0, len)
    const pBL = this.project3D(-halfW, 0, 0);
    const pBR = this.project3D(halfW, 0, 0);
    const pTR = this.project3D(halfW, 0, len);
    const pTL = this.project3D(-halfW, 0, len);

    // 1. Draw Table Undercarriage Legs (dark sports metal)
    const legY = -110;
    const legBL = this.project3D(-halfW + 20, legY, 20);
    const legBR = this.project3D(halfW - 20, legY, 20);
    const legTL = this.project3D(-halfW + 20, legY, len - 20);
    const legTR = this.project3D(halfW - 20, legY, len - 20);

    this.ctx.save();
    this.ctx.strokeStyle = '#1a2233';
    this.ctx.lineWidth = 5;
    [
      [pBL, legBL],
      [pBR, legBR],
      [pTL, legTL],
      [pTR, legTR],
    ].forEach(([top, bot]) => {
      this.ctx.beginPath();
      this.ctx.moveTo(top.x, top.y);
      this.ctx.lineTo(bot.x, bot.y);
      this.ctx.stroke();
    });
    this.ctx.restore();

    // 2. Table Thickness (beveled wood edge)
    const thickBL = this.project3D(-halfW, -8, 0);
    const thickBR = this.project3D(halfW, -8, 0);

    this.ctx.fillStyle = '#0a101d';
    this.ctx.beginPath();
    this.ctx.moveTo(pBL.x, pBL.y);
    this.ctx.lineTo(pBR.x, pBR.y);
    this.ctx.lineTo(thickBR.x, thickBR.y);
    this.ctx.lineTo(thickBL.x, thickBL.y);
    this.ctx.closePath();
    this.ctx.fill();

    // 3. Main Table Surface (with lighting gradient)
    const surfaceGrad = this.ctx.createLinearGradient(0, pTL.y, 0, pBL.y);
    if (theme === 'neon') {
      surfaceGrad.addColorStop(0, '#061324');
      surfaceGrad.addColorStop(1, '#092542');
    } else if (theme === 'cyber') {
      surfaceGrad.addColorStop(0, '#15062a');
      surfaceGrad.addColorStop(1, '#2a0c4f');
    } else if (theme === 'lava') {
      surfaceGrad.addColorStop(0, '#1f0707');
      surfaceGrad.addColorStop(1, '#3b0e0e');
    } else if (theme === 'legendary') {
      surfaceGrad.addColorStop(0, '#19150b');
      surfaceGrad.addColorStop(1, '#2c2514');
    } else {
      // Official ITTF Deep Blue Table
      surfaceGrad.addColorStop(0, '#0c2340');
      surfaceGrad.addColorStop(1, '#1d4575');
    }

    this.ctx.fillStyle = surfaceGrad;
    this.ctx.beginPath();
    this.ctx.moveTo(pBL.x, pBL.y);
    this.ctx.lineTo(pBR.x, pBR.y);
    this.ctx.lineTo(pTR.x, pTR.y);
    this.ctx.lineTo(pTL.x, pTL.y);
    this.ctx.closePath();
    this.ctx.fill();

    // 4. Official White Table Borders & Center Line
    this.ctx.save();
    this.ctx.strokeStyle = theme === 'legendary' ? '#ffd700' : '#ffffff';
    this.ctx.lineWidth = 2.5;

    // Outer border
    this.ctx.beginPath();
    this.ctx.moveTo(pBL.x, pBL.y);
    this.ctx.lineTo(pBR.x, pBR.y);
    this.ctx.lineTo(pTR.x, pTR.y);
    this.ctx.lineTo(pTL.x, pTL.y);
    this.ctx.closePath();
    this.ctx.stroke();

    // Longitudinal White Center Line
    const centerNear = this.project3D(0, 0, 0);
    const centerFar = this.project3D(0, 0, len);
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();
    this.ctx.moveTo(centerNear.x, centerNear.y);
    this.ctx.lineTo(centerFar.x, centerFar.y);
    this.ctx.stroke();

    this.ctx.restore();
  }

  render3DNet() {
    const halfW = this.tableW / 2 + 15; // Net posts extend 15cm outside table
    const netZ = this.netZ;
    const netH = this.netH;

    // Net bottom posts & top posts in 3D
    const pBL = this.project3D(-halfW, 0, netZ);
    const pBR = this.project3D(halfW, 0, netZ);
    const pTL = this.project3D(-halfW, netH, netZ);
    const pTR = this.project3D(halfW, netH, netZ);

    this.ctx.save();

    // Mesh body (semi-transparent dark mesh)
    this.ctx.fillStyle = 'rgba(10, 18, 30, 0.72)';
    this.ctx.beginPath();
    this.ctx.moveTo(pBL.x, pBL.y);
    this.ctx.lineTo(pBR.x, pBR.y);
    this.ctx.lineTo(pTR.x, pTR.y);
    this.ctx.lineTo(pTL.x, pTL.y);
    this.ctx.closePath();
    this.ctx.fill();

    // Grid lines on net
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    this.ctx.lineWidth = 1;
    for (let x = -halfW; x <= halfW; x += 18) {
      const bot = this.project3D(x, 0, netZ);
      const top = this.project3D(x, netH, netZ);
      this.ctx.beginPath();
      this.ctx.moveTo(bot.x, bot.y);
      this.ctx.lineTo(top.x, top.y);
      this.ctx.stroke();
    }

    // White Top Tape
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 3;
    this.ctx.beginPath();
    this.ctx.moveTo(pTL.x, pTL.y);
    this.ctx.lineTo(pTR.x, pTR.y);
    this.ctx.stroke();

    // Metal Net Posts
    this.ctx.strokeStyle = '#64748b';
    this.ctx.lineWidth = 5;
    this.ctx.beginPath();
    this.ctx.moveTo(pBL.x, pBL.y);
    this.ctx.lineTo(pTL.x, pTL.y);
    this.ctx.moveTo(pBR.x, pBR.y);
    this.ctx.lineTo(pTR.x, pTR.y);
    this.ctx.stroke();

    this.ctx.restore();
  }

  renderBallShadow() {
    // Project shadow directly onto table surface (y = 0)
    const isOverTable = Math.abs(this.ball.x) <= this.tableW / 2 && this.ball.z >= 0 && this.ball.z <= this.tableL;
    const shadowY = isOverTable ? 0 : -105; // on table or on floor
    const pShadow = this.project3D(this.ball.x, shadowY, this.ball.z);

    if (!pShadow.visible) return;

    // Shadow darkens and tightens when closer to surface
    const heightAboveSurface = Math.max(0, this.ball.y - shadowY);
    const alpha = Math.max(0.1, 0.65 - heightAboveSurface * 0.005);
    const rx = (this.ball.radius * 1.5 + heightAboveSurface * 0.08) * pShadow.scale;
    const ry = rx * 0.45; // perspective flattening

    this.ctx.save();
    this.ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
    this.ctx.beginPath();
    this.ctx.ellipse(pShadow.x, pShadow.y, rx, ry, 0, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

  render3DBall() {
    const user = window.storageEngine?.getCurrentUser();
    const ballId = user?.equipped?.ball || 'ball_classic';
    const ballItem = window.storageEngine?.getCatalog().find((i) => i.id === ballId);
    const ballColor = ballItem?.color || '#ffffff';
    const trailType = ballItem?.trailType || 'classic';

    // 1. Draw 3D Trail
    this.ball.trail.forEach((t, i) => {
      const p = this.project3D(t.x, t.y, t.z);
      if (!p.visible) return;
      this.ctx.save();
      this.ctx.globalAlpha = t.alpha * 0.5;
      let c = ballColor;
      if (trailType === 'fire') c = '#ff5400';
      if (trailType === 'electric') c = '#ffd166';
      if (trailType === 'galaxy') c = '#c77dff';
      if (trailType === 'legendary') c = '#ffd700';
      this.ctx.fillStyle = c;
      const r = (this.ball.radius * 0.7 * (i / this.ball.trail.length)) * p.scale;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, Math.max(1, r), 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    });

    // 2. Project 3D Ball
    const pBall = this.project3D(this.ball.x, this.ball.y, this.ball.z);
    if (!pBall.visible) return;

    const r = Math.max(3, this.ball.radius * pBall.scale);

    this.ctx.save();
    // Ball Outer Glow
    this.ctx.shadowColor = ballColor;
    this.ctx.shadowBlur = 10;

    // 3D Sphere shading with specular highlight
    const ballGrad = this.ctx.createRadialGradient(
      pBall.x - r * 0.3, pBall.y - r * 0.35, r * 0.1,
      pBall.x, pBall.y, r
    );
    ballGrad.addColorStop(0, '#ffffff');
    ballGrad.addColorStop(0.3, ballColor);
    ballGrad.addColorStop(1, '#94a3b8');

    this.ctx.fillStyle = ballGrad;
    this.ctx.beginPath();
    this.ctx.arc(pBall.x, pBall.y, r, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.restore();
  }

  // Project dynamic table tennis paddle shadow onto table / floor
  renderPaddleShadow(x, y, z, isPlayer) {
    const isOverTable = Math.abs(x) <= this.tableW / 2 + 35 && z >= -40 && z <= this.tableL + 40;
    const shadowY = isOverTable ? 0 : -105;
    const pShadow = this.project3D(x, shadowY, z);
    if (!pShadow.visible) return;

    const heightAboveSurface = Math.max(0, y - shadowY);
    const alpha = Math.max(0.05, (isPlayer ? 0.42 : 0.30) - heightAboveSurface * 0.0035);
    const baseW = isPlayer ? this.player.width : this.ai.width;
    const rx = (baseW * 0.48 + heightAboveSurface * 0.08) * pShadow.scale;
    const ry = rx * 0.46; // perspective projection tilt on table

    this.ctx.save();
    this.ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
    this.ctx.beginPath();
    this.ctx.ellipse(pShadow.x, pShadow.y, rx, ry, isPlayer ? 0.25 : -0.25, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

  // Authentic Table Tennis Blade Head Contour (Realistic Competition Silhouette)
  drawBladeHeadPath(ctx, w, h) {
    ctx.beginPath();
    // Top apex curve
    ctx.moveTo(0, -h * 0.52);
    // Right upper dome to sweet spot (widest section at ~40% of height)
    ctx.bezierCurveTo(w * 0.35, -h * 0.52, w * 0.53, -h * 0.22, w * 0.51, h * 0.06);
    // Right sweet spot down to blade shoulder
    ctx.bezierCurveTo(w * 0.48, h * 0.25, w * 0.36, h * 0.38, w * 0.22, h * 0.45);
    // Right shoulder into handle throat
    ctx.bezierCurveTo(w * 0.16, h * 0.48, w * 0.14, h * 0.50, w * 0.13, h * 0.53);
    // Handle neck base line
    ctx.lineTo(-w * 0.13, h * 0.53);
    // Left shoulder transition
    ctx.bezierCurveTo(-w * 0.14, h * 0.50, -w * 0.16, h * 0.48, -w * 0.22, h * 0.45);
    // Left sweet spot
    ctx.bezierCurveTo(-w * 0.36, h * 0.38, -w * 0.48, h * 0.25, -w * 0.51, h * 0.06);
    // Left upper dome
    ctx.bezierCurveTo(-w * 0.53, -h * 0.22, -w * 0.35, -h * 0.52, 0, -h * 0.52);
    ctx.closePath();
  }

  // Authentic Ergonomic Flared (FL) Wooden Handle Path
  drawFlaredHandlePath(ctx, w, topY, botY) {
    const topW = w * 0.26;
    const midW = w * 0.21;
    const botW = w * 0.31;
    const midY = topY + (botY - topY) * 0.45;

    ctx.beginPath();
    ctx.moveTo(-topW / 2, topY);
    ctx.bezierCurveTo(-midW / 2, midY, -midW / 2, midY + (botY - topY) * 0.25, -botW / 2, botY);
    // Convex flared bottom butt
    ctx.bezierCurveTo(-botW / 2, botY + 7, botW / 2, botY + 7, botW / 2, botY);
    ctx.bezierCurveTo(midW / 2, midY + (botY - topY) * 0.25, midW / 2, midY, topW / 2, topY);
    ctx.closePath();
  }

  // Render Hyper-Realistic Table Tennis Paddle in 3D
  renderTableTennisPaddle(x, y, z, isPlayer, isForehand, swingProgress, customColor, customAccent) {
    const p = this.project3D(x, y, z);
    if (!p.visible) return;

    const baseW = isPlayer ? this.player.width : this.ai.width;
    const baseH = isPlayer ? this.player.height : this.ai.height;
    const w = baseW * p.scale;
    const h = baseH * p.scale;

    this.ctx.save();
    this.ctx.translate(p.x, p.y);

    // Natural racket tilt angle based on forehand vs backhand and swing progress
    const tilt = isForehand ? -0.20 - swingProgress * 0.35 : 0.20 + swingProgress * 0.35;
    this.ctx.rotate(tilt);

    const handleTopY = h * 0.46;
    const handleBotY = h * 1.05;
    const rimThickness = Math.max(2, 4.5 * p.scale);

    // 1. Forearm & Compression Sweatband (for Player in foreground)
    if (isPlayer) {
      this.ctx.save();
      // Athlete Wrist / Forearm
      const armGrad = this.ctx.createLinearGradient(-w * 0.18, 0, w * 0.18, 0);
      armGrad.addColorStop(0, '#be8a58');
      armGrad.addColorStop(0.35, '#d4a373');
      armGrad.addColorStop(0.85, '#e0a96d');
      armGrad.addColorStop(1, '#a67344');
      this.ctx.fillStyle = armGrad;
      this.roundRect(this.ctx, -w * 0.18, h * 0.98, w * 0.36, h * 0.55, 6, true);

      // Athletic Wrist Sweatband with Team Piping
      const bandColor = customColor || '#00f2fe';
      const bandGrad = this.ctx.createLinearGradient(-w * 0.23, 0, w * 0.23, 0);
      bandGrad.addColorStop(0, '#0284c7');
      bandGrad.addColorStop(0.5, bandColor);
      bandGrad.addColorStop(1, '#0369a1');
      this.ctx.fillStyle = bandGrad;
      this.ctx.shadowColor = customAccent || 'rgba(0, 242, 254, 0.4)';
      this.ctx.shadowBlur = 8;
      this.roundRect(this.ctx, -w * 0.22, h * 0.84, w * 0.44, h * 0.24, 7, true);
      this.ctx.shadowBlur = 0;

      // Sweatband center white athletic stripe
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillRect(-w * 0.22, h * 0.94, w * 0.44, 3 * p.scale);
      this.ctx.restore();
    }

    // 2. Flared Wooden Handle (Layered Rosewood & Birch Inlay)
    this.ctx.save();
    // Handle Outer Mahogany Scales with 3D Cylindrical Shading
    const woodGrad = this.ctx.createLinearGradient(-w * 0.16, 0, w * 0.16, 0);
    woodGrad.addColorStop(0, '#3f1f0a');
    woodGrad.addColorStop(0.2, '#6a3810');
    woodGrad.addColorStop(0.5, '#8c5024');
    woodGrad.addColorStop(0.75, '#ab6835');
    woodGrad.addColorStop(0.92, '#6a3810');
    woodGrad.addColorStop(1, '#3f1f0a');

    this.ctx.fillStyle = woodGrad;
    this.drawFlaredHandlePath(this.ctx, w, handleTopY, handleBotY);
    this.ctx.fill();

    // Wood Grain Fine Vertical Lines
    this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    this.ctx.lineWidth = 1;
    [-w * 0.08, -w * 0.04, w * 0.04, w * 0.08].forEach((gx) => {
      this.ctx.beginPath();
      this.ctx.moveTo(gx, handleTopY + 2);
      this.ctx.lineTo(gx * 1.25, handleBotY - 4);
      this.ctx.stroke();
    });

    // Handle Center Laminated Racing Stripe (Birch wood inlay)
    const stripeGrad = this.ctx.createLinearGradient(-w * 0.045, 0, w * 0.045, 0);
    stripeGrad.addColorStop(0, '#d6ccc2');
    stripeGrad.addColorStop(0.5, '#f5ebe0');
    stripeGrad.addColorStop(1, '#d6ccc2');
    this.ctx.fillStyle = stripeGrad;
    this.ctx.fillRect(-w * 0.045, handleTopY + 4, w * 0.09, handleBotY - handleTopY - 14);

    // Dark Carbon Pinstripe in center of inlay
    this.ctx.fillStyle = '#1e1b18';
    this.ctx.fillRect(-w * 0.012, handleTopY + 4, w * 0.024, handleBotY - handleTopY - 14);

    // Metallic Brand Badge / Lens Medallion at Handle Butt
    this.ctx.save();
    const badgeY = handleBotY - 10 * p.scale;
    const badgeW = w * 0.12;
    const badgeH = 8 * p.scale;
    const badgeGrad = this.ctx.createLinearGradient(-badgeW, badgeY, badgeW, badgeY);
    badgeGrad.addColorStop(0, '#d97706');
    badgeGrad.addColorStop(0.5, '#fbbf24');
    badgeGrad.addColorStop(1, '#b45309');
    this.ctx.fillStyle = badgeGrad;
    this.ctx.shadowColor = '#fbbf24';
    this.ctx.shadowBlur = 5;
    this.ctx.beginPath();
    this.ctx.ellipse(0, badgeY, badgeW, badgeH, 0, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.shadowBlur = 0;

    // Lens reflection
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    this.ctx.beginPath();
    this.ctx.ellipse(-badgeW * 0.3, badgeY - 2, badgeW * 0.4, badgeH * 0.45, -0.3, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();

    this.ctx.restore();

    // 3. Multi-Ply Blade Core & Sponge Layer (ITTF Sandwich Construction)
    this.ctx.save();
    // Layer A: 5-Ply Blade Wooden Core Base (Birch veneer)
    this.ctx.save();
    this.ctx.translate(0, 0);
    this.ctx.scale(1 + rimThickness / (w * 0.5), 1 + rimThickness / (h * 0.5));
    this.ctx.fillStyle = '#c68b59';
    this.drawBladeHeadPath(this.ctx, w, h);
    this.ctx.fill();
    this.ctx.restore();

    // Layer B: Vibrant Orange High-Tension Sponge Layer (~2.1mm competition sponge)
    this.ctx.save();
    const spongeOffset = rimThickness * 0.7;
    this.ctx.scale(1 + spongeOffset / (w * 0.5), 1 + spongeOffset / (h * 0.5));
    this.ctx.fillStyle = '#ff6b35';
    this.drawBladeHeadPath(this.ctx, w, h);
    this.ctx.fill();
    this.ctx.restore();

    // Layer C: ITTF Protective Fabric Side Edge Tape (Black with metallic trim)
    this.ctx.save();
    this.ctx.strokeStyle = '#0f172a';
    this.ctx.lineWidth = rimThickness * 0.65;
    this.drawBladeHeadPath(this.ctx, w, h);
    this.ctx.stroke();

    this.ctx.strokeStyle = '#d4af37';
    this.ctx.lineWidth = 1 * p.scale;
    this.drawBladeHeadPath(this.ctx, w, h);
    this.ctx.stroke();
    this.ctx.restore();

    // 4. Inverted Grippy Rubber Surface
    // Regulation: Front face uses selected color, Back face uses contrasting ITTF black
    const rubberColor = customColor || (isForehand ? '#dc2626' : '#0f172a');

    // Equipped Racket Aura Glow
    if (customAccent) {
      this.ctx.shadowColor = customAccent;
      this.ctx.shadowBlur = isPlayer ? 18 : 8;
    }

    // High-Tension Matte Rubber Surface Gradient with Natural Light Dropoff
    const rubberGrad = this.ctx.createRadialGradient(-w * 0.16, -h * 0.20, w * 0.08, 0, 0, w * 0.68);
    rubberGrad.addColorStop(0, '#ffffff');
    rubberGrad.addColorStop(0.18, rubberColor);
    rubberGrad.addColorStop(0.78, rubberColor);
    rubberGrad.addColorStop(1, isForehand ? '#450a0a' : '#020617');

    this.ctx.fillStyle = rubberGrad;
    this.drawBladeHeadPath(this.ctx, w, h);
    this.ctx.fill();
    this.ctx.shadowBlur = 0;

    // Rubber Chamfer Edge Ring
    this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    this.ctx.lineWidth = 1.5 * p.scale;
    this.drawBladeHeadPath(this.ctx, w, h);
    this.ctx.stroke();

    // Realistic Specular Curved Highlight Arc on Sweet Spot
    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
    this.ctx.lineWidth = 3.5 * p.scale;
    this.ctx.beginPath();
    this.ctx.ellipse(-w * 0.12, -h * 0.14, w * 0.30, h * 0.32, 0, -Math.PI * 0.75, -Math.PI * 0.18);
    this.ctx.stroke();

    // Secondary subtle lower soft shine
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    this.ctx.lineWidth = 2 * p.scale;
    this.ctx.beginPath();
    this.ctx.ellipse(-w * 0.06, -h * 0.08, w * 0.38, h * 0.40, 0, -Math.PI * 0.8, -Math.PI * 0.25);
    this.ctx.stroke();
    this.ctx.restore();

    // Embossed Official ITTF Approval Seal at base of rubber
    this.ctx.save();
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    this.ctx.font = `700 ${Math.max(6, Math.floor(7 * p.scale))}px "Rajdhani", sans-serif`;
    this.ctx.textAlign = 'center';
    this.ctx.fillText('🏓 ITTF 29-008 • PRO SERIES', 0, h * 0.40);
    this.ctx.restore();

    this.ctx.restore();

    // 5. Anatomical Athlete Hand & Fingers (Shakehand Grip for Player)
    if (isPlayer) {
      this.ctx.save();
      const skinBase = '#d4a373';
      const skinShadow = '#b07d4b';
      const skinHighlight = '#f3c99f';

      // Three fingers wrapped tightly around the flared handle scales
      const fingerYOffsets = [h * 0.58, h * 0.70, h * 0.82];
      const fingerWidths = [w * 0.32, w * 0.30, w * 0.28];

      fingerYOffsets.forEach((fy, idx) => {
        const fw = fingerWidths[idx];
        const fGrad = this.ctx.createLinearGradient(-fw / 2, fy, fw / 2, fy);
        fGrad.addColorStop(0, skinShadow);
        fGrad.addColorStop(0.3, skinHighlight);
        fGrad.addColorStop(0.7, skinBase);
        fGrad.addColorStop(1, skinShadow);

        this.ctx.fillStyle = fGrad;
        this.ctx.shadowColor = 'rgba(0,0,0,0.3)';
        this.ctx.shadowBlur = 3;
        this.roundRect(this.ctx, -fw * 0.52, fy, fw, 9 * p.scale, 4, true);

        // Knuckle crease accent line
        this.ctx.shadowBlur = 0;
        this.ctx.strokeStyle = 'rgba(80, 40, 15, 0.35)';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.moveTo(-fw * 0.15, fy + 2);
        this.ctx.lineTo(-fw * 0.15, fy + 7 * p.scale);
        this.ctx.stroke();
      });

      // Athlete Thumb resting securely on the blade shoulder (Signature Shakehand Grip)
      this.ctx.save();
      const thumbX = isForehand ? -w * 0.14 : w * 0.14;
      const thumbY = h * 0.48;
      const thumbRot = isForehand ? 0.35 : -0.35;

      const thumbGrad = this.ctx.createRadialGradient(thumbX, thumbY, 2, thumbX, thumbY, 14 * p.scale);
      thumbGrad.addColorStop(0, skinHighlight);
      thumbGrad.addColorStop(0.6, skinBase);
      thumbGrad.addColorStop(1, skinShadow);

      this.ctx.fillStyle = thumbGrad;
      this.ctx.beginPath();
      this.ctx.ellipse(thumbX, thumbY, 11 * p.scale, 7 * p.scale, thumbRot, 0, Math.PI * 2);
      this.ctx.fill();

      // Thumbnail sheen
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      this.ctx.beginPath();
      this.ctx.ellipse(thumbX + (isForehand ? 3 : -3), thumbY - 1, 4 * p.scale, 3 * p.scale, thumbRot, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();

      this.ctx.restore();
    }

    this.ctx.restore();
  }

  renderPlayerRacket() {
    const user = window.storageEngine?.getCurrentUser();
    const racketId = user?.equipped?.racket || 'racket_classic';
    const racketItem = window.storageEngine?.getCatalog().find((i) => i.id === racketId);

    this.renderTableTennisPaddle(
      this.player.x,
      this.player.y,
      this.player.z,
      true,
      this.player.isForehand,
      this.player.swingProgress,
      racketItem?.color,
      racketItem?.glow
    );
  }

  // Render Opponent AI Athlete Character + Paddle across the table
  renderAiRacket() {
    const p = this.project3D(this.ai.x, this.ai.y, this.ai.z);
    if (!p.visible) return;

    // Draw Opponent Athlete Body in 3D Perspective!
    this.ctx.save();
    this.ctx.translate(p.x, p.y + 45 * p.scale);

    // Jersey Color adapting to Phase progression
    const phaseColors = [
      '#2563eb', '#0284c7', '#0d9488', '#059669', '#16a34a',
      '#ca8a04', '#ea580c', '#dc2626', '#e11d48', '#9333ea',
      '#7c3aed', '#4f46e5', '#db2777', '#f43f5e', '#ffd700'
    ];
    const jerseyColor = phaseColors[Math.min(14, this.currentPhase - 1)] || '#2563eb';

    const athleteScale = p.scale * 1.35;

    // Athlete Torso / Jersey
    this.ctx.fillStyle = jerseyColor;
    this.ctx.beginPath();
    this.ctx.roundRect
      ? this.ctx.roundRect(-24 * athleteScale, -10 * athleteScale, 48 * athleteScale, 55 * athleteScale, 8 * athleteScale)
      : this.ctx.rect(-24 * athleteScale, -10 * athleteScale, 48 * athleteScale, 55 * athleteScale);
    this.ctx.fill();

    // Team Collar & Number
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(-8 * athleteScale, -10 * athleteScale, 16 * athleteScale, 6 * athleteScale);
    this.ctx.font = `800 ${Math.max(8, 14 * athleteScale)}px "Orbitron", sans-serif`;
    this.ctx.textAlign = 'center';
    this.ctx.fillText(String(this.currentPhase), 0, 24 * athleteScale);

    // Athlete Neck & Head
    this.ctx.fillStyle = '#d4a373';
    this.ctx.fillRect(-6 * athleteScale, -18 * athleteScale, 12 * athleteScale, 10 * athleteScale);
    this.ctx.beginPath();
    this.ctx.arc(0, -28 * athleteScale, 14 * athleteScale, 0, Math.PI * 2);
    this.ctx.fill();

    // Hair / Headband
    this.ctx.fillStyle = '#0f172a';
    this.ctx.beginPath();
    this.ctx.arc(0, -32 * athleteScale, 13 * athleteScale, Math.PI, Math.PI * 2);
    this.ctx.fill();
    this.ctx.fillStyle = '#00f2fe';
    this.ctx.fillRect(-14 * athleteScale, -30 * athleteScale, 28 * athleteScale, 3 * athleteScale);

    this.ctx.restore();

    // Draw Opponent's Table Tennis Paddle held in hand
    this.renderTableTennisPaddle(
      this.ai.x,
      this.ai.y,
      this.ai.z,
      false,
      this.ai.isForehand,
      this.ai.swingProgress,
      '#ef4444',
      'rgba(239, 68, 68, 0.7)'
    );
  }

  render3DParticles() {
    this.particles.forEach((p) => {
      const proj = this.project3D(p.x, p.y, p.z);
      if (!proj.visible) return;
      this.ctx.save();
      this.ctx.globalAlpha = p.alpha;
      this.ctx.fillStyle = p.color;
      this.ctx.beginPath();
      this.ctx.arc(proj.x, proj.y, p.size * proj.scale, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    });

    this.floatingTexts.forEach((ft) => {
      this.ctx.save();
      this.ctx.globalAlpha = ft.alpha;
      this.ctx.fillStyle = ft.color;
      this.ctx.font = 'bold 22px "Orbitron", sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.shadowColor = ft.color;
      this.ctx.shadowBlur = 12;
      this.ctx.fillText(ft.text, ft.x, ft.y);
      this.ctx.restore();
    });
  }

  renderOverlays() {
    // 1. In-Canvas Broadcast Scoreboard Graphic (guaranteed visibility at all times, including fullscreen)
    this.ctx.save();
    const bannerW = 460;
    const bannerH = 42;
    const bannerX = this.width / 2 - bannerW / 2;
    const bannerY = 16;

    // Broadcast Pill Background
    this.ctx.fillStyle = 'rgba(7, 14, 28, 0.88)';
    this.ctx.shadowColor = 'rgba(0, 242, 254, 0.4)';
    this.ctx.shadowBlur = 12;
    this.roundRect(this.ctx, bannerX, bannerY, bannerW, bannerH, 10, true);

    // Pill Cyan Border
    this.ctx.strokeStyle = 'rgba(0, 242, 254, 0.55)';
    this.ctx.lineWidth = 1.5;
    this.roundRect(this.ctx, bannerX, bannerY, bannerW, bannerH, 10, false, true);

    // Phase Tag on Left
    this.ctx.fillStyle = '#00f2fe';
    this.ctx.font = '700 12px "Orbitron", sans-serif';
    this.ctx.textAlign = 'left';
    this.ctx.fillText(`FASE ${this.currentPhase}`, bannerX + 16, bannerY + 26);

    // Score in Center
    this.ctx.textAlign = 'center';
    this.ctx.font = '900 18px "Orbitron", sans-serif';
    this.ctx.fillStyle = '#ffffff';
    this.ctx.shadowColor = '#00f2fe';
    this.ctx.shadowBlur = 8;
    this.ctx.fillText(`VOCÊ  ${this.playerScore}  ×  ${this.aiScore}  ADV`, this.width / 2, bannerY + 27);

    // Rule or Status Notice
    this.ctx.textAlign = 'right';
    this.ctx.font = '700 10px "Rajdhani", sans-serif';
    if (this.playerScore >= 11 && this.aiScore >= 11) {
      this.ctx.fillStyle = '#ffd166';
      this.ctx.fillText('DEUCE (+2)', bannerX + bannerW - 16, bannerY + 26);
    } else {
      this.ctx.fillStyle = '#94a3b8';
      this.ctx.fillText('12 PTS • +2 LEAD', bannerX + bannerW - 16, bannerY + 26);
    }
    this.ctx.restore();

    // Service state indicator at bottom
    if (this.servicePhase === 'ready') {
      this.ctx.save();
      this.ctx.textAlign = 'center';
      this.ctx.font = '700 20px "Orbitron", sans-serif';
      if (this.server === 'player') {
        this.ctx.fillStyle = '#00f5d4';
        this.ctx.shadowColor = '#00f5d4';
        this.ctx.shadowBlur = 14;
        this.ctx.fillText('SUA VEZ DE SACAR • CLIQUE OU APERTE [ESPAÇO]', this.width / 2, this.height - 45);
      } else {
        this.ctx.fillStyle = '#ffd166';
        this.ctx.fillText('AGUARDANDO SAQUE DO ADVERSÁRIO...', this.width / 2, this.height - 45);
      }
      this.ctx.restore();
    }

    // Pause Overlay
    if (this.isPaused) {
      this.ctx.save();
      this.ctx.fillStyle = 'rgba(5, 11, 20, 0.85)';
      this.ctx.fillRect(0, 0, this.width, this.height);

      this.ctx.textAlign = 'center';
      this.ctx.font = '900 48px "Orbitron", sans-serif';
      this.ctx.fillStyle = '#ffd166';
      this.ctx.shadowColor = '#ffd166';
      this.ctx.shadowBlur = 20;
      this.ctx.fillText('PARTIDA PAUSADA', this.width / 2, this.height / 2);

      this.ctx.font = '600 18px "Rajdhani", sans-serif';
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillText('Pressione [ESPAÇO] ou o botão de pausa para continuar', this.width / 2, this.height / 2 + 45);
      this.ctx.restore();
    }
  }

  onResize() {
    this.canvas.width = this.width;
    this.canvas.height = this.height;
  }

  roundRect(ctx, x, y, width, height, radius = 5, fill = true, stroke = false) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }
}

// Global class export
window.PingPongGame = TableTennisGame;
window.TableTennisGame = TableTennisGame;

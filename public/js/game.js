/**
 * Game Engine for (DS) OpenCV Memory Game
 * Controls the 3 stages, sequence generation, memorization timer, 
 * OpenCV gesture answering window, and scoring logic.
 */

class GameEngine {
  constructor() {
    this.currentStage = 1;
    this.stageConfigs = {
      1: { count: 5, displayInterval: 3000, responseInterval: 5000 },
      2: { count: 8, displayInterval: 2000, responseInterval: 4000 },
      3: { count: 9, displayInterval: 1500, responseInterval: 3000 }
    };

    this.activeSequence = [];
    this.userSequence = [];
    this.currentInputIndex = 0;
    this.inputTimer = null;
    this.inputTimeLeft = 0;
    this.memorizeTimer = null;

    this.participant = null;
    this.team = null;
    this.stageScores = { 1: 0, 2: 0, 3: 0 };
    this.totalScore = 0;
  }

  async loadConfig() {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      if (data.stages) {
        if (data.stages.stage1) {
          this.stageConfigs[1] = {
            count: data.stages.stage1.numbersCount || 5,
            displayInterval: (data.stages.stage1.displayIntervalSeconds || 3) * 1000,
            responseInterval: (data.stages.stage1.responseIntervalSeconds || 5) * 1000
          };
        }
        if (data.stages.stage2) {
          this.stageConfigs[2] = {
            count: data.stages.stage2.numbersCount || 8,
            displayInterval: (data.stages.stage2.displayIntervalSeconds || 2) * 1000,
            responseInterval: (data.stages.stage2.responseIntervalSeconds || 4) * 1000
          };
        }
        if (data.stages.stage3) {
          this.stageConfigs[3] = {
            count: data.stages.stage3.numbersCount || 9,
            displayInterval: (data.stages.stage3.displayIntervalSeconds || 1.5) * 1000,
            responseInterval: (data.stages.stage3.responseIntervalSeconds || 3) * 1000
          };
        }
      }
    } catch (e) {
      console.warn('Failed to load server config, using defaults:', e);
    }
  }

  setParticipantData(participant, team) {
    this.participant = participant;
    this.team = team;
    if (participant.scores) {
      this.stageScores[1] = participant.scores.stage1 || 0;
      this.stageScores[2] = participant.scores.stage2 || 0;
      this.stageScores[3] = participant.scores.stage3 || 0;
      this.totalScore = participant.scores.total || 0;
    }
  }

  generateSequence(count) {
    // Only numbers 1 to 9, no 2 numbers shall repeat, cryptographically secure Fisher-Yates shuffle
    const pool = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const n = Math.min(count || 5, pool.length);
    const randBuffer = new Uint32Array(pool.length);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(randBuffer);
    } else {
      for (let i = 0; i < randBuffer.length; i++) {
        randBuffer[i] = Math.floor(Math.random() * 1000000);
      }
    }
    for (let i = pool.length - 1; i > 0; i--) {
      const j = randBuffer[i] % (i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, n);
  }

  // Update status on server (e.g. playing_stage_1)
  async updateServerStatus(status) {
    if (!this.participant) return;
    try {
      await fetch('/api/participant/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rollNumber: this.participant.rollNumber,
          status
        })
      });
    } catch (e) {
      console.error('Error updating status:', e);
    }
  }

  // 1. Start Stage Flow
  async startStage(stageNum) {
    this.currentStage = stageNum;
    const config = this.stageConfigs[stageNum];
    this.activeSequence = this.generateSequence(config.count);
    this.userSequence = [];
    this.currentInputIndex = 0;

    await this.updateServerStatus(`playing_stage_${stageNum}`);

    // Update UI Stage tracker
    document.querySelectorAll('.stage-step').forEach((el, idx) => {
      el.classList.toggle('active', idx + 1 === stageNum);
    });

    // Show Stage Briefing Screen
    document.getElementById('stage-brief-screen').style.display = 'block';
    document.getElementById('memorize-phase-screen').style.display = 'none';
    document.getElementById('opencv-box-screen').style.display = 'none';
    document.getElementById('stage-review-screen').style.display = 'none';
    document.getElementById('final-results-screen').style.display = 'none';

    document.getElementById('brief-stage-title').textContent = `Stage ${stageNum} Briefing`;
    document.getElementById('brief-numbers-count').textContent = `${config.count} Numbers`;
    document.getElementById('brief-display-time').textContent = `${config.displayInterval / 1000}s Interval`;
    document.getElementById('brief-response-time').textContent = `${config.responseInterval / 1000}s Answer Time`;

    window.soundEngine.init();
  }

  // 2. Begin Countdown to Memorization
  beginCountdown() {
    document.getElementById('stage-brief-screen').style.display = 'none';
    document.getElementById('memorize-phase-screen').style.display = 'flex';

    // Render sequence step slots strip
    this.renderMemorizeSlotsStrip();

    let count = 3;
    const bigDigit = document.getElementById('memorize-digit');
    const label = document.getElementById('memorize-stage-indicator');
    const heading = document.getElementById('memorize-heading');
    const progFill = document.getElementById('memorize-progress-fill');
    const countdownText = document.getElementById('memorize-countdown-text');

    if (label) label.textContent = `GET READY! SEQUENCE STARTING`;
    if (heading) heading.textContent = `Sequence starting in ${count}...`;
    if (bigDigit) bigDigit.textContent = count;
    if (progFill) progFill.style.width = '100%';
    if (countdownText) countdownText.textContent = `${count}s`;
    window.soundEngine.playCountdownTick();

    const interval = setInterval(() => {
      count--;
      if (count > 0) {
        if (bigDigit) bigDigit.textContent = count;
        if (heading) heading.textContent = `Sequence starting in ${count}...`;
        if (countdownText) countdownText.textContent = `${count}s`;
        window.soundEngine.playCountdownTick();
      } else {
        clearInterval(interval);
        window.soundEngine.playGoBeep();
        this.runMemorizationSequence();
      }
    }, 1000);
  }

  renderMemorizeSlotsStrip() {
    const strip = document.getElementById('memorize-slots-strip');
    if (!strip) return;
    strip.innerHTML = '';
    const total = this.activeSequence.length;
    for (let i = 0; i < total; i++) {
      const slot = document.createElement('div');
      slot.className = 'mem-slot-item';
      slot.id = `mem-slot-${i}`;
      slot.textContent = `#${i + 1}`;
      strip.appendChild(slot);
    }
  }

  // 3. Play the numbers sequence one-by-one (Ultra Prominent Sequence Display)
  runMemorizationSequence() {
    const config = this.stageConfigs[this.currentStage];
    let index = 0;
    const total = this.activeSequence.length;

    const showNext = () => {
      if (index >= total) {
        // Memorization finished -> Transition to Split Gesture Arena
        this.openOpenCVOutputBox();
        return;
      }

      const num = this.activeSequence[index];
      const bigDigit = document.getElementById('memorize-digit');
      const label = document.getElementById('memorize-stage-indicator');
      const heading = document.getElementById('memorize-heading');
      const progFill = document.getElementById('memorize-progress-fill');
      const countdownText = document.getElementById('memorize-countdown-text');

      // Update prominent sequence badges
      if (label) label.textContent = `SEQUENCE NUMBER ${index + 1} OF ${total}`;
      if (heading) heading.textContent = `Observe & Memorize Digit #${index + 1} of ${total}`;
      if (countdownText) countdownText.textContent = `${(config.displayInterval / 1000).toFixed(1)}s`;

      if (bigDigit) {
        bigDigit.textContent = num;
        bigDigit.parentElement.style.animation = 'none';
        bigDigit.parentElement.offsetHeight; // trigger reflow
        bigDigit.parentElement.style.animation = 'scale-pop 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
      }

      // Update memorization slots strip
      document.querySelectorAll('.mem-slot-item').forEach((slot, i) => {
        slot.classList.remove('active');
        if (i < index) slot.classList.add('passed');
        if (i === index) slot.classList.add('active');
      });

      window.soundEngine.playDigitBeep();

      // Animate progress bar fill over displayInterval
      if (progFill) {
        progFill.style.transition = 'none';
        progFill.style.width = '100%';
        setTimeout(() => {
          progFill.style.transition = `width ${config.displayInterval}ms linear`;
          progFill.style.width = '0%';
        }, 40);
      }

      index++;
      this.memorizeTimer = setTimeout(showNext, config.displayInterval);
    };

    showNext();
  }

  // 4. Open OpenCV Output Box & Start Hand Gesture Answering
  async openOpenCVOutputBox() {
    document.getElementById('memorize-phase-screen').style.display = 'none';
    document.getElementById('opencv-box-screen').style.display = 'block';

    // Populate Top Left: Team Name and Active Participant Name
    const tName = this.team ? this.team.name : (localStorage.getItem('aarohan_team') ? JSON.parse(localStorage.getItem('aarohan_team')).name : 'Team Alpha');
    const pName = this.participant ? this.participant.name : (localStorage.getItem('aarohan_participant') ? JSON.parse(localStorage.getItem('aarohan_participant')).name : 'Participant');
    const pRoll = this.participant ? this.participant.rollNumber : (localStorage.getItem('aarohan_participant') ? JSON.parse(localStorage.getItem('aarohan_participant')).rollNumber : '');

    const teamEl = document.getElementById('arena-team-name');
    const memberEl = document.getElementById('arena-member-name');
    const rollEl = document.getElementById('arena-member-roll');
    const stagePill = document.getElementById('arena-stage-title-pill');

    if (teamEl) teamEl.textContent = tName;
    if (memberEl) memberEl.textContent = pName;
    if (rollEl) rollEl.textContent = pRoll ? `(Roll: ${pRoll})` : '';
    if (stagePill) stagePill.innerHTML = `<span class="status-dot"></span> <span>STAGE ${this.currentStage} IN PROGRESS</span>`;

    const videoEl = document.getElementById('webcam-video');
    const canvasEl = document.getElementById('vision-canvas');

    await window.visionEngine.init(videoEl, canvasEl);
    const camStarted = await window.visionEngine.startCamera();

    if (!camStarted) {
      alert('Camera is required for OpenCV Gesture detection. Please verify camera permissions.');
      return;
    }

    // Manual Confirm Digit Button (Fallback)
    const lockBtn = document.getElementById('btn-manual-lock');
    if (lockBtn) {
      lockBtn.onclick = () => {
        if (!this.isStepLocked) {
          const d = window.visionEngine.currentDigit !== null ? window.visionEngine.currentDigit : 0;
          this.handleDigitLocked(d, d === this.expectedDigit);
        }
      };
    }

    // Keyboard Fallback (1-9)
    if (this._keyListener) document.removeEventListener('keydown', this._keyListener);
    this._keyListener = (e) => {
      if (e.key >= '1' && e.key <= '9' && !this.isStepLocked) {
        const val = parseInt(e.key);
        this.handleDigitLocked(val, val === this.expectedDigit);
      }
    };
    document.addEventListener('keydown', this._keyListener);

    // Frame update for HUD elements & instant correct gesture detection
    window.visionEngine.onDigitLocked = null; // Controlled by game engine
    window.visionEngine.onFrameUpdate = (data) => {
      this.updateHudOverlay(data);
    };

    // Render Bottom Right: Stage Sequence Grid
    this.renderStageSequenceGrid();
    this.startAnswerStep(0);
  }

  // Bottom Right Grid of Sequence Numbers of this specific stage
  renderStageSequenceGrid() {
    const grid = document.getElementById('stage-sequence-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const total = this.activeSequence.length;

    const subtitle = document.getElementById('sequence-grid-subtitle');
    if (subtitle) {
      subtitle.textContent = `Stage ${this.currentStage} (${total} Numbers)`;
    }

    for (let i = 0; i < total; i++) {
      const item = document.createElement('div');
      item.className = 'stage-grid-item';
      item.id = `stage-slot-${i}`;
      item.innerHTML = `
        <div class="slot-idx">#${i + 1}</div>
        <div class="slot-icon" id="stage-slot-icon-${i}">⏳</div>
        <div class="slot-val" id="stage-slot-val-${i}">?</div>
      `;
      grid.appendChild(item);
    }
  }

  getOrdinal(n) {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // 5. Start answering for step `index`
  startAnswerStep(index) {
    const config = this.stageConfigs[this.currentStage];
    const total = this.activeSequence.length;

    if (index >= total) {
      // Completed all inputs in stage!
      this.finishStage();
      return;
    }

    this.currentInputIndex = index;
    this.expectedDigit = this.activeSequence[index];
    this.lastDetectedDigit = null;
    this.isStepLocked = false;

    // Highlight current slot in bottom-right grid
    document.querySelectorAll('.stage-grid-item').forEach((el, i) => {
      if (i === index) {
        el.classList.add('slot-active');
      } else {
        el.classList.remove('slot-active');
      }
    });

    const ordinalStr = this.getOrdinal(index + 1);

    // 1. Central Top: Prominently show current sequence position
    const posNumber = document.getElementById('central-pos-number');
    if (posNumber) {
      posNumber.textContent = `SHOW SEQUENCE #${index + 1} OF ${total}`;
    }

    const posInstruction = document.getElementById('central-pos-instruction');
    if (posInstruction) {
      posInstruction.textContent = `Present the ${ordinalStr} number from memory`;
    }

    // Reset status ribbon
    const statusIcon = document.getElementById('central-status-icon');
    const statusText = document.getElementById('central-status-text');
    if (statusIcon) statusIcon.textContent = '⚡';
    if (statusText) statusText.textContent = 'Correct answer immediately locks and advances · Else waits for timer';

    // Reset central detected digit and clear green tick mark
    const centralCard = document.getElementById('central-detected-card');
    if (centralCard) centralCard.classList.remove('match-correct');
    const digitDisplay = document.getElementById('central-detected-digit');
    if (digitDisplay) digitDisplay.textContent = '--';

    // 2. Below that: Show the Timer
    const startTime = Date.now();
    const duration = config.responseInterval;
    this.inputTimeLeft = duration / 1000;

    if (this.inputTimer) clearInterval(this.inputTimer);

    const timerDigits = document.getElementById('central-countdown-text');
    const timerFill = document.getElementById('central-timer-fill');
    const timerCard = document.getElementById('central-timer-card');

    if (timerDigits) timerDigits.textContent = `${this.inputTimeLeft.toFixed(1)}s`;
    if (timerFill) timerFill.style.width = '100%';
    if (timerCard) timerCard.className = 'central-timer-card timer-normal';

    this.inputTimer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const left = Math.max(0, (duration - elapsed) / 1000);
      this.inputTimeLeft = left;

      if (timerDigits) timerDigits.textContent = `${left.toFixed(1)}s`;

      const pct = Math.max(0, Math.min(100, (left / (duration / 1000)) * 100));
      if (timerFill) timerFill.style.width = `${pct}%`;

      if (timerCard) {
        if (left <= 1.5) {
          timerCard.className = 'central-timer-card timer-urgent';
        } else if (left <= 2.5) {
          timerCard.className = 'central-timer-card timer-warning';
        } else {
          timerCard.className = 'central-timer-card timer-normal';
        }
      }

      if (left <= 0) {
        clearInterval(this.inputTimer);
        if (this.isStepLocked) return;
        this.isStepLocked = true;

        // Timer expired! User did NOT show correct answer
        // "if correct answer not detected wait till the timer ends. The number at the last should be considered as answer then."
        const finalDigit = (this.lastDetectedDigit !== null)
          ? this.lastDetectedDigit
          : (window.visionEngine.currentDigit !== null ? window.visionEngine.currentDigit : 0);

        if (statusText) {
          statusText.innerHTML = `<span style="color: var(--accent-gold); font-weight: 700;">⏱️ Time up! Submitting last gesture: ${finalDigit}</span>`;
        }

        const isCorrect = (finalDigit === this.expectedDigit);
        this.handleDigitLocked(finalDigit, isCorrect);
      }
    }, 40);
  }

  // Frame update from camera stream
  updateHudOverlay(data) {
    const digitDisplay = document.getElementById('central-detected-digit');
    const handsBreakdown = document.getElementById('central-hands-breakdown');
    const cameraHandStatus = document.getElementById('camera-hand-status');
    const lockBtn = document.getElementById('btn-manual-lock');
    const statusIcon = document.getElementById('central-status-icon');
    const statusText = document.getElementById('central-status-text');

    const detected = data.detectedDigit;

    if (detected !== null) {
      this.lastDetectedDigit = detected;
      if (digitDisplay) digitDisplay.textContent = detected;
      if (cameraHandStatus) cameraHandStatus.textContent = `Hand: ${detected}`;

      const handStr = data.handDetails.map(h => `${h.label}: ${h.count}`).join(' | ');
      if (handsBreakdown) handsBreakdown.textContent = `${handStr} (Fingers: ${data.totalExtended})`;
      if (lockBtn) lockBtn.textContent = `Confirm Digit (${detected})`;
    } else {
      if (digitDisplay && !this.isStepLocked) digitDisplay.textContent = '--';
      if (cameraHandStatus) cameraHandStatus.textContent = 'Waiting for hand';
      if (handsBreakdown) handsBreakdown.textContent = 'Show hand in camera view (0 to 9)';
      if (lockBtn) lockBtn.textContent = 'Confirm Digit (0)';
    }

    // User rule:
    // "also remove the threshold parameter
    // if the correct number is detected mark it as correct and move to next number , if correct answer not detected wait till the timer ends"
    if (!this.isStepLocked && this.expectedDigit !== undefined && detected !== null) {
      if (detected === this.expectedDigit) {
        // INSTANT ADVANCE ON CORRECT GESTURE! No threshold delay!
        this.isStepLocked = true;
        if (this.inputTimer) clearInterval(this.inputTimer);

        if (statusIcon) statusIcon.textContent = '✅';
        if (statusText) {
          statusText.innerHTML = `<strong style="color: var(--accent-green); font-size: 0.95rem;">CORRECT NUMBER (${detected})!</strong> Moving to next number...`;
        }

        this.handleDigitLocked(detected, true);
      } else {
        if (statusIcon) statusIcon.textContent = '✋';
        if (statusText) {
          statusText.innerHTML = `Showing: <strong>${detected}</strong> &middot; Waiting for correct number or timer expiry`;
        }
      }
    }
  }

  // 6. Handle Digit Locked & Update Stage Sequence Grid (Green if correct, Red if wrong)
  handleDigitLocked(digit, isCorrect = false) {
    if (this.inputTimer) clearInterval(this.inputTimer);
    this.isStepLocked = true;

    window.soundEngine.playLockIn();
    this.userSequence.push(digit);

    // Update central detected card visual state
    const centralCard = document.getElementById('central-detected-card');
    const digitDisplay = document.getElementById('central-detected-digit');
    if (digitDisplay) digitDisplay.textContent = digit;

    if (isCorrect) {
      // User rule: "if the shown digit is correct, make the digit icon green, show a large tick mark and then move to the next number"
      if (centralCard) centralCard.classList.add('match-correct');
    } else {
      if (centralCard) centralCard.classList.remove('match-correct');
    }

    // Update the slot in the Bottom Right stage sequence grid
    const slotItem = document.getElementById(`stage-slot-${this.currentInputIndex}`);
    const slotIcon = document.getElementById(`stage-slot-icon-${this.currentInputIndex}`);
    const slotVal = document.getElementById(`stage-slot-val-${this.currentInputIndex}`);

    if (slotItem) {
      slotItem.classList.remove('slot-active');
      if (isCorrect) {
        // User rule: "if answered correctly make the number icon green"
        slotItem.classList.add('slot-correct');
        if (slotIcon) slotIcon.textContent = '✓';
        if (slotVal) slotVal.textContent = digit;
      } else {
        // User rule: "if wrong then red"
        slotItem.classList.add('slot-wrong');
        if (slotIcon) slotIcon.textContent = '✗';
        if (slotVal) slotVal.textContent = digit;
      }
    }

    // Brief delay before advancing to next step (allows user to see large green tick mark)
    const delay = isCorrect ? 420 : 280;
    setTimeout(() => {
      if (centralCard) centralCard.classList.remove('match-correct');
      this.startAnswerStep(this.currentInputIndex + 1);
    }, delay);
  }

  // 7. Finish Stage, Calculate Score, and Submit
  async finishStage() {
    if (this.inputTimer) clearInterval(this.inputTimer);
    if (this._keyListener) {
      document.removeEventListener('keydown', this._keyListener);
      this._keyListener = null;
    }
    window.visionEngine.stopCamera();
    document.getElementById('opencv-box-screen').style.display = 'none';
    document.getElementById('stage-review-screen').style.display = 'block';

    // Judging criteria: Count of right numbers in matching positions = points
    let stageScore = 0;
    const total = this.activeSequence.length;

    for (let i = 0; i < total; i++) {
      if (this.activeSequence[i] === this.userSequence[i]) {
        stageScore++;
      }
    }

    this.stageScores[this.currentStage] = stageScore;
    this.totalScore = (this.stageScores[1] || 0) + (this.stageScores[2] || 0) + (this.stageScores[3] || 0);

    // Render review UI
    document.getElementById('review-stage-title').textContent = `Stage ${this.currentStage} Results`;
    document.getElementById('review-score-num').textContent = stageScore;
    document.getElementById('review-score-denom').textContent = `out of ${total} points`;

    const compareGrid = document.getElementById('review-compare-grid');
    compareGrid.innerHTML = '';

    for (let i = 0; i < total; i++) {
      const orig = this.activeSequence[i];
      const user = this.userSequence[i];
      const isMatch = orig === user;

      const col = document.createElement('div');
      col.className = 'compare-col';
      col.innerHTML = `
        <div class="orig-box" title="Expected">${orig}</div>
        <div class="user-box ${isMatch ? 'match' : 'mismatch'}" title="Your Gesture">${user}</div>
        <span style="font-size:0.75rem; color:${isMatch ? '#10b981' : '#ef4444'}">${isMatch ? '✓' : '✗'}</span>
      `;
      compareGrid.appendChild(col);
    }

    if (stageScore > total / 2) {
      window.soundEngine.playSuccess();
    } else {
      window.soundEngine.playError();
    }

    // Submit stage score to server
    try {
      const payload = {
        rollNumber: this.participant.rollNumber,
        teamCode: this.participant.teamCode,
        stageNumber: this.currentStage,
        sequenceShown: this.activeSequence,
        sequenceEntered: this.userSequence,
        score: stageScore
      };

      const res = await fetch('/api/game/submit-stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success && data.teamTotalScore !== undefined) {
        document.getElementById('review-team-total').textContent = `Team Total: ${data.teamTotalScore} pts`;
      }
    } catch (e) {
      console.error('Error submitting stage score:', e);
    }

    // Configure Next button
    const nextBtn = document.getElementById('btn-review-next');
    if (this.currentStage < 3) {
      nextBtn.textContent = `Proceed to Stage ${this.currentStage + 1} →`;
      nextBtn.onclick = () => this.startStage(this.currentStage + 1);
    } else {
      nextBtn.textContent = `View Final Score & Results 🏆`;
      nextBtn.onclick = () => this.showFinalResults();
    }
  }

  // 8. Show Final Results Certificate
  showFinalResults() {
    document.getElementById('stage-review-screen').style.display = 'none';
    document.getElementById('final-results-screen').style.display = 'block';

    document.getElementById('final-player-name').textContent = this.participant.name;
    document.getElementById('final-player-roll').textContent = `Roll No: ${this.participant.rollNumber}`;
    document.getElementById('final-team-name').textContent = `Team: ${this.team.name} (${this.team.code})`;

    document.getElementById('final-s1-score').textContent = `${this.stageScores[1]} / ${this.stageConfigs[1].count}`;
    document.getElementById('final-s2-score').textContent = `${this.stageScores[2]} / ${this.stageConfigs[2].count}`;
    document.getElementById('final-s3-score').textContent = `${this.stageScores[3]} / ${this.stageConfigs[3].count}`;

    document.getElementById('final-total-score').textContent = this.totalScore;
    window.soundEngine.playSuccess();
  }
}

window.gameEngine = new GameEngine();

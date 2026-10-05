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
      3: { count: 10, displayInterval: 1500, responseInterval: 3000 }
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
            count: data.stages.stage3.numbersCount || 10,
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
    const seq = [];
    for (let i = 0; i < count; i++) {
      seq.push(Math.floor(Math.random() * 10)); // 0 <= X <= 9
    }
    return seq;
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

    let count = 3;
    const bigDigit = document.getElementById('memorize-digit');
    const label = document.getElementById('memorize-stage-indicator');
    const progFill = document.getElementById('memorize-progress-fill');

    label.textContent = `Get Ready! Sequence starting in...`;
    bigDigit.textContent = count;
    progFill.style.width = '100%';
    window.soundEngine.playCountdownTick();

    const interval = setInterval(() => {
      count--;
      if (count > 0) {
        bigDigit.textContent = count;
        window.soundEngine.playCountdownTick();
      } else {
        clearInterval(interval);
        window.soundEngine.playGoBeep();
        this.runMemorizationSequence();
      }
    }, 1000);
  }

  // 3. Play the numbers sequence one-by-one
  runMemorizationSequence() {
    const config = this.stageConfigs[this.currentStage];
    let index = 0;
    const total = this.activeSequence.length;

    const showNext = () => {
      if (index >= total) {
        // Memorization finished -> Transition to OpenCV Output Box
        this.openOpenCVOutputBox();
        return;
      }

      const num = this.activeSequence[index];
      const bigDigit = document.getElementById('memorize-digit');
      const label = document.getElementById('memorize-stage-indicator');
      const progFill = document.getElementById('memorize-progress-fill');

      label.textContent = `Memorize Sequence: Number ${index + 1} of ${total}`;
      bigDigit.textContent = num;
      bigDigit.parentElement.style.animation = 'none';
      bigDigit.parentElement.offsetHeight; // trigger reflow
      bigDigit.parentElement.style.animation = 'scale-pop 0.3s ease';

      window.soundEngine.playDigitBeep();

      // Animate progress bar fill over displayInterval
      progFill.style.transition = 'none';
      progFill.style.width = '100%';
      setTimeout(() => {
        progFill.style.transition = `width ${config.displayInterval}ms linear`;
        progFill.style.width = '0%';
      }, 50);

      index++;
      this.memorizeTimer = setTimeout(showNext, config.displayInterval);
    };

    showNext();
  }

  // 4. Open OpenCV Output Box & Start Hand Gesture Answering
  async openOpenCVOutputBox() {
    document.getElementById('memorize-phase-screen').style.display = 'none';
    document.getElementById('opencv-box-screen').style.display = 'block';

    const videoEl = document.getElementById('webcam-video');
    const canvasEl = document.getElementById('vision-canvas');

    await window.visionEngine.init(videoEl, canvasEl);
    const camStarted = await window.visionEngine.startCamera();

    if (!camStarted) {
      alert('Camera is required for OpenCV Gesture detection. Please verify permissions.');
      return;
    }

    // Manual Confirm Digit Button
    const lockBtn = document.getElementById('btn-manual-lock');
    if (lockBtn) {
      lockBtn.onclick = () => {
        if (!this.isStepLocked) {
          const d = window.visionEngine.currentDigit !== null ? window.visionEngine.currentDigit : 0;
          this.handleDigitLocked(d, d === this.expectedDigit);
        }
      };
    }

    // Keyboard Fallback (0-9)
    if (this._keyListener) document.removeEventListener('keydown', this._keyListener);
    this._keyListener = (e) => {
      if (e.key >= '0' && e.key <= '9' && !this.isStepLocked) {
        const val = parseInt(e.key);
        this.handleDigitLocked(val, val === this.expectedDigit);
      }
    };
    document.addEventListener('keydown', this._keyListener);

    // Frame update for HUD elements & 0.5s correct hold detection
    window.visionEngine.onDigitLocked = null; // Controlled by game engine
    window.visionEngine.onFrameUpdate = (data) => {
      this.updateHudOverlay(data);
    };

    // Setup sequence trail
    this.renderSequenceTrail();
    this.startAnswerStep(0);
  }

  renderSequenceTrail() {
    const trailEl = document.getElementById('sequence-trail');
    trailEl.innerHTML = '';
    const total = this.activeSequence.length;

    for (let i = 0; i < total; i++) {
      const box = document.createElement('div');
      box.className = 'trail-digit';
      box.id = `trail-digit-${i}`;
      box.textContent = `#${i + 1}`;
      trailEl.appendChild(box);
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
    this.correctHoldStartTime = null;
    this.lastDetectedDigit = null;
    this.isStepLocked = false;

    // Highlight current trail slot
    document.querySelectorAll('.trail-digit').forEach((el, i) => {
      el.classList.toggle('current', i === index);
    });

    const ordinalStr = this.getOrdinal(index + 1);

    // Update Prominent Position Header directly above video box
    const placePill = document.getElementById('prominent-place-pill');
    if (placePill) {
      placePill.innerHTML = `<span class="place-icon">🎯</span> <span class="place-title">POSITION #${index + 1}</span>`;
    }

    const targetHeading = document.getElementById('prominent-target-heading');
    if (targetHeading) {
      targetHeading.textContent = `Show ${ordinalStr} Number (Place ${index + 1} of ${total})`;
    }

    const targetSubtext = document.getElementById('prominent-target-subtext');
    if (targetSubtext) {
      targetSubtext.textContent = `Present the ${ordinalStr} digit from memory. Hold the correct number for 0.5s to advance!`;
    }

    // Floating overlay pill
    const targetStepPill = document.getElementById('hud-target-step');
    if (targetStepPill) {
      targetStepPill.textContent = `Place ${index + 1} of ${total}`;
    }

    // Reset Ribbon state
    const criteriaIcon = document.getElementById('criteria-icon');
    if (criteriaIcon) criteriaIcon.textContent = '⏳';
    const criteriaMsg = document.getElementById('criteria-msg');
    if (criteriaMsg) {
      criteriaMsg.innerHTML = `Hold <strong>correct answer</strong> for <strong>0.5s</strong> to advance immediately &middot; Otherwise, last detected number is submitted at 0.0s`;
    }
    const criteriaFill = document.getElementById('criteria-meter-fill');
    if (criteriaFill) criteriaFill.style.width = '0%';
    const hudHoldBar = document.getElementById('hud-hold-progress-bar');
    if (hudHoldBar) hudHoldBar.style.width = '0%';

    // Start step countdown timer
    const startTime = Date.now();
    const duration = config.responseInterval;
    this.inputTimeLeft = duration / 1000;

    if (this.inputTimer) clearInterval(this.inputTimer);

    const timerDigits = document.getElementById('prominent-countdown-text');
    const timerFill = document.getElementById('prominent-timer-fill');
    const timerBox = document.getElementById('prominent-timer-box');
    const timerBadge = document.getElementById('hud-timer-badge');

    if (timerDigits) timerDigits.textContent = `${this.inputTimeLeft.toFixed(1)}s`;
    if (timerBadge) timerBadge.textContent = `${this.inputTimeLeft.toFixed(1)}s`;
    if (timerFill) timerFill.style.width = '100%';
    if (timerBox) timerBox.className = 'prominent-timer-box timer-normal';

    this.inputTimer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const left = Math.max(0, (duration - elapsed) / 1000);
      this.inputTimeLeft = left;

      if (timerDigits) timerDigits.textContent = `${left.toFixed(1)}s`;
      if (timerBadge) timerBadge.textContent = `${left.toFixed(1)}s`;

      const pct = Math.max(0, Math.min(100, (left / (duration / 1000)) * 100));
      if (timerFill) timerFill.style.width = `${pct}%`;

      if (timerBox) {
        if (left <= 1.5) {
          timerBox.className = 'prominent-timer-box timer-urgent';
        } else if (left <= 2.5) {
          timerBox.className = 'prominent-timer-box timer-warning';
        } else {
          timerBox.className = 'prominent-timer-box timer-normal';
        }
      }

      if (left <= 0) {
        clearInterval(this.inputTimer);
        if (this.isStepLocked) return;
        this.isStepLocked = true;

        // Timer expired! User did NOT hold correct answer for 0.5s
        // "The number at the last should be considered as answer then."
        const finalDigit = (this.lastDetectedDigit !== null) 
          ? this.lastDetectedDigit 
          : (window.visionEngine.currentDigit !== null ? window.visionEngine.currentDigit : 0);

        if (criteriaMsg) {
          criteriaMsg.innerHTML = `<span style="color: var(--accent-gold); font-weight: 700;">⏱️ Time expired! Locked in final gesture: ${finalDigit}</span>`;
        }

        this.handleDigitLocked(finalDigit, false);
      }
    }, 40);
  }

  updateHudOverlay(data) {
    const digitBadge = document.getElementById('hud-detected-digit');
    const breakdownEl = document.getElementById('hud-hands-breakdown');
    const lockBtn = document.getElementById('btn-manual-lock');
    const criteriaIcon = document.getElementById('criteria-icon');
    const criteriaMsg = document.getElementById('criteria-msg');
    const criteriaFill = document.getElementById('criteria-meter-fill');
    const hudHoldBar = document.getElementById('hud-hold-progress-bar');

    const detected = data.detectedDigit;
    if (detected !== null) {
      this.lastDetectedDigit = detected;
      if (digitBadge) digitBadge.textContent = detected;
      const handStr = data.handDetails.map(h => `${h.label}: ${h.count}`).join(' | ');
      if (breakdownEl) breakdownEl.textContent = `${handStr} (Fingers: ${data.totalExtended})`;
      if (lockBtn) lockBtn.textContent = `Confirm Digit (${detected})`;
    } else {
      if (digitBadge) digitBadge.textContent = '--';
      if (breakdownEl) breakdownEl.textContent = 'Show hand in camera view (0 to 9)';
      if (lockBtn) lockBtn.textContent = 'Confirm Digit (0)';
    }

    // Check 0.5s Correct Answer Hold Rule
    if (!this.isStepLocked && this.expectedDigit !== undefined) {
      const isCorrect = (detected !== null && detected === this.expectedDigit);

      if (isCorrect) {
        if (!this.correctHoldStartTime) {
          this.correctHoldStartTime = Date.now();
        }
        const elapsed = Date.now() - this.correctHoldStartTime;
        const holdProgress = Math.min(elapsed / 500, 1.0); // 0.5s = 500ms

        if (criteriaFill) criteriaFill.style.width = `${holdProgress * 100}%`;
        if (hudHoldBar) hudHoldBar.style.width = `${holdProgress * 100}%`;
        if (criteriaIcon) criteriaIcon.textContent = '🎯';
        if (criteriaMsg) {
          criteriaMsg.innerHTML = `<strong style="color: var(--accent-green); font-size: 0.95rem;">CORRECT NUMBER (${detected})!</strong> Holding: ${(elapsed / 1000).toFixed(1)}s / 0.5s to advance...`;
        }

        if (elapsed >= 500) {
          // Lock in early!
          this.isStepLocked = true;
          if (this.inputTimer) clearInterval(this.inputTimer);

          if (criteriaFill) criteriaFill.style.width = '100%';
          if (hudHoldBar) hudHoldBar.style.width = '100%';
          if (criteriaIcon) criteriaIcon.textContent = '✅';
          if (criteriaMsg) {
            criteriaMsg.innerHTML = `<strong style="color: var(--accent-cyan); font-size: 1rem;">PERFECT MATCH! Locked in ${detected} & Advancing...</strong>`;
          }

          this.handleDigitLocked(detected, true);
        }
      } else {
        // Not correct answer (wrong digit or no hand shown)
        this.correctHoldStartTime = null;
        if (criteriaFill) criteriaFill.style.width = '0%';
        if (hudHoldBar) hudHoldBar.style.width = '0%';

        if (detected !== null) {
          if (criteriaIcon) criteriaIcon.textContent = '✋';
          if (criteriaMsg) {
            criteriaMsg.innerHTML = `Showing: <strong>${detected}</strong> &middot; (Waiting for timer expiry or correct gesture)`;
          }
        } else {
          if (criteriaIcon) criteriaIcon.textContent = '⏳';
          if (criteriaMsg) {
            criteriaMsg.innerHTML = `Hold <strong>correct answer</strong> for <strong>0.5s</strong> to advance &middot; Otherwise, last detected number is submitted at 0.0s`;
          }
        }
      }
    }
  }

  // 6. Handle Digit Locked
  handleDigitLocked(digit, isEarlyCorrect = false) {
    if (this.inputTimer) clearInterval(this.inputTimer);
    this.isStepLocked = true;

    window.soundEngine.playLockIn();
    this.userSequence.push(digit);

    // Update visual trail box
    const trailBox = document.getElementById(`trail-digit-${this.currentInputIndex}`);
    if (trailBox) {
      trailBox.textContent = digit;
      trailBox.classList.remove('current');
      if (digit === this.expectedDigit) {
        trailBox.classList.add('correct');
      } else {
        trailBox.classList.add('entered');
      }
    }

    // Small delay before advancing to next digit
    setTimeout(() => {
      this.startAnswerStep(this.currentInputIndex + 1);
    }, 280);
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

/**
 * Main Application Orchestrator & View Controller
 * Ties together Landing Page, Team Lobby, Game Arena, Audience Leaderboard, and Admin
 */

class App {
  constructor() {
    this.currentView = 'landing';
    this.participant = null;
    this.team = null;
  }

  init() {
    // Check local storage for existing session
    const savedPart = localStorage.getItem('aarohan_participant');
    const savedTeam = localStorage.getItem('aarohan_team');

    if (savedPart && savedTeam) {
      try {
        this.participant = JSON.parse(savedPart);
        this.team = JSON.parse(savedTeam);
      } catch (e) {}
    }

    // Initialize subsystems
    if (window.leaderboardManager) window.leaderboardManager.init();
    if (window.gameEngine) window.gameEngine.loadConfig();

    // Bind forms and events
    this.bindEvents();

    // Route view
    const hash = window.location.hash.replace('#', '');
    if (hash === 'admin' && window.adminManager.isLoggedIn()) {
      this.switchView('admin-hub');
      window.adminManager.loadAdminView();
    } else if (this.participant && this.team) {
      this.refreshTeamLobby();
    } else {
      this.switchView('landing');
    }
  }

  switchView(viewId) {
    // Restrict Admin Hub to Admin Only
    if (viewId === 'admin-hub' && !window.adminManager.isLoggedIn()) {
      this.openModal('modal-admin-login');
      return;
    }

    this.currentView = viewId;
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));

    const target = document.getElementById(`view-${viewId}`);
    if (target) {
      target.classList.add('active');
      window.scrollTo(0, 0);
    }

    // Update active nav button
    document.querySelectorAll('.btn-nav').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewId);
    });

    if (viewId === 'admin-hub') {
      window.adminManager.loadAdminView();
    }
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span>${type === 'success' ? '✓' : type === 'error' ? '⚠' : 'ℹ'}</span>
      <span>${message}</span>
    `;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'slideInRight 0.3s ease reverse forwards';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('active');
  }

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
  }

  bindEvents() {
    // Global Navigation
    document.querySelectorAll('.btn-nav').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        if (view === 'admin-hub') {
          if (window.adminManager.isLoggedIn()) {
            this.switchView('admin-hub');
          } else {
            this.openModal('modal-admin-login');
          }
        } else if (view === 'team-lobby') {
          if (this.participant && this.team) {
            this.refreshTeamLobby();
            this.switchView('team-lobby');
          } else {
            this.showToast('Please create or join a team first!', 'error');
            this.switchView('landing');
          }
        } else {
          this.switchView(view);
        }
      });
    });

    // Close modals on click outside
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.classList.remove('active');
          if (overlay.id === 'modal-practice') {
            window.visionEngine.stopCamera();
          }
        }
      });
    });

    // Create Team Form Submit (Leader)
    const createTeamForm = document.getElementById('form-create-team');
    if (createTeamForm) {
      createTeamForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          teamName: document.getElementById('ct-team-name').value,
          leaderName: document.getElementById('ct-leader-name').value,
          rollNumber: document.getElementById('ct-roll-number').value,
          email: document.getElementById('ct-email').value,
          phone: document.getElementById('ct-phone').value
        };

        try {
          const res = await fetch('/api/participant/create-team', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();

          if (!res.ok) {
            alert(data.error || 'Failed to create team');
            return;
          }

          this.participant = data.participant;
          this.team = data.team;
          localStorage.setItem('aarohan_participant', JSON.stringify(this.participant));
          localStorage.setItem('aarohan_team', JSON.stringify(this.team));

          this.closeModal('modal-create-team');
          this.showToast(`Team "${this.team.name}" created! Code: ${this.team.code}`, 'success');
          this.refreshTeamLobby();
          this.switchView('team-lobby');
        } catch (err) {
          alert('Network or server error while creating team');
        }
      });
    }

    // Join Team Form Submit (Teammate)
    const joinTeamForm = document.getElementById('form-join-team');
    if (joinTeamForm) {
      joinTeamForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          teamCode: document.getElementById('jt-team-code').value,
          memberName: document.getElementById('jt-member-name').value,
          rollNumber: document.getElementById('jt-roll-number').value,
          email: document.getElementById('jt-email').value,
          phone: document.getElementById('jt-phone').value
        };

        try {
          const res = await fetch('/api/participant/join-team', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();

          if (!res.ok) {
            alert(data.error || 'Failed to join team');
            return;
          }

          this.participant = data.participant;
          this.team = data.team;
          localStorage.setItem('aarohan_participant', JSON.stringify(this.participant));
          localStorage.setItem('aarohan_team', JSON.stringify(this.team));

          this.closeModal('modal-join-team');
          this.showToast(`Joined team "${this.team.name}" successfully!`, 'success');
          this.refreshTeamLobby();
          this.switchView('team-lobby');
        } catch (err) {
          alert('Network or server error while joining team');
        }
      });
    }

    // Admin Login Form
    const adminForm = document.getElementById('form-admin-login');
    if (adminForm) {
      adminForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = document.getElementById('admin-password').value;
        const ok = await window.adminManager.login(password);
        if (ok) {
          this.closeModal('modal-admin-login');
          this.switchView('admin-hub');
          window.adminManager.loadAdminView();
          this.showToast('Admin Command Center unlocked.', 'success');
        }
      });
    }

    // Keyboard shortcuts in Game Arena (0-9 override)
    window.addEventListener('keydown', (e) => {
      if (this.currentView === 'game-arena' && window.visionEngine.isRunning) {
        if (e.key >= '0' && e.key <= '9') {
          const digit = parseInt(e.key);
          window.gameEngine.handleDigitLocked(digit);
        }
      }
    });

    // Manual Confirm Digit Button in OpenCV HUD
    const btnManualLock = document.getElementById('btn-manual-lock');
    if (btnManualLock) {
      btnManualLock.addEventListener('click', () => {
        const cur = window.visionEngine.currentDigit !== null ? window.visionEngine.currentDigit : 0;
        window.gameEngine.handleDigitLocked(cur);
      });
    }
  }

  // Refresh Team Lobby Data
  async refreshTeamLobby() {
    if (!this.team || !this.team.code) return;

    try {
      const res = await fetch(`/api/team/${this.team.code}`);
      const data = await res.json();
      if (!res.ok) {
        console.warn('Team fetch error');
        return;
      }

      this.team = data.team;
      const members = data.members || [];

      // Update current participant reference
      if (this.participant) {
        const updatedMe = members.find(m => m.rollNumber.toUpperCase() === this.participant.rollNumber.toUpperCase());
        if (updatedMe) {
          this.participant = updatedMe;
          localStorage.setItem('aarohan_participant', JSON.stringify(this.participant));
        }
      }

      // Populate Lobby Elements
      document.getElementById('lobby-team-name').textContent = this.team.name;
      document.getElementById('lobby-team-code').textContent = this.team.code;
      document.getElementById('lobby-team-score').textContent = this.team.totalScore || 0;

      // Populate Members Table
      const tbody = document.getElementById('lobby-members-tbody');
      tbody.innerHTML = '';

      members.forEach(m => {
        const tr = document.createElement('tr');
        const isCurrent = this.participant && m.rollNumber.toUpperCase() === this.participant.rollNumber.toUpperCase();
        if (isCurrent) tr.style.background = 'rgba(0, 245, 212, 0.05)';

        const s1 = m.scores?.stage1 !== null ? `${m.scores.stage1}` : '-';
        const s2 = m.scores?.stage2 !== null ? `${m.scores.stage2}` : '-';
        const s3 = m.scores?.stage3 !== null ? `${m.scores.stage3}` : '-';

        tr.innerHTML = `
          <td>
            <strong>${m.name}</strong> ${m.isLeader ? '<span class="badge-tag">Leader</span>' : ''} ${isCurrent ? '<span class="badge-tag" style="background:rgba(255,255,255,0.1); color:#fff;">You</span>' : ''}<br>
            <span style="font-size:0.75rem; color:var(--text-dim);">${m.phone ? '📞 ' + m.phone : (m.college || '')}</span>
          </td>
          <td><code style="color:var(--text-main);">${m.rollNumber}</code></td>
          <td><span class="badge-status ${m.status}">${m.status}</span></td>
          <td>S1: ${s1} | S2: ${s2} | S3: ${s3}</td>
          <td><strong style="color:var(--accent-cyan); font-family:var(--font-mono); font-size:1.1rem;">${m.scores?.total || 0} pts</strong></td>
        `;
        tbody.appendChild(tr);
      });

      // Update Game Start Button Status
      const startBtn = document.getElementById('btn-lobby-start-game');
      if (this.participant && this.participant.status === 'finished') {
        startBtn.textContent = 'Game Completed (View Certificate)';
        startBtn.onclick = () => {
          window.gameEngine.setParticipantData(this.participant, this.team);
          this.switchView('game-arena');
          window.gameEngine.showFinalResults();
        };
      } else {
        startBtn.textContent = 'Enter Game Arena (Stage 1) 🚀';
        startBtn.onclick = () => {
          window.gameEngine.setParticipantData(this.participant, this.team);
          this.switchView('game-arena');
          window.gameEngine.startStage(1);
        };
      }
    } catch (e) {
      console.error('Error refreshing team lobby:', e);
    }
  }

  copyTeamCode() {
    if (!this.team || !this.team.code) return;
    navigator.clipboard.writeText(this.team.code).then(() => {
      this.showToast(`Team Code "${this.team.code}" copied to clipboard!`, 'success');
    });
  }

  leaveTeam() {
    if (confirm('Are you sure you want to sign out from this team?')) {
      localStorage.removeItem('aarohan_participant');
      localStorage.removeItem('aarohan_team');
      this.participant = null;
      this.team = null;
      this.switchView('landing');
      this.showToast('Signed out of team.');
    }
  }

  // Practice & Calibration Mode
  async openPracticeModal() {
    this.openModal('modal-practice');
    const v = document.getElementById('practice-video');
    const c = document.getElementById('practice-canvas');

    await window.visionEngine.init(v, c);
    await window.visionEngine.startCamera();

    window.visionEngine.onFrameUpdate = (data) => {
      const disp = document.getElementById('practice-detected-digit');
      const det = document.getElementById('practice-breakdown');
      if (disp && det) {
        if (data.detectedDigit !== null) {
          disp.textContent = data.detectedDigit;
          let handStr = data.handDetails.map(h => `${h.label}: ${h.count}`).join(' | ');
          det.textContent = `${handStr} (Total: ${data.totalExtended} fingers)`;
        } else {
          disp.textContent = '--';
          det.textContent = 'Hold hand in front of camera';
        }
      }
    };
  }

  closePracticeModal() {
    window.visionEngine.stopCamera();
    this.closeModal('modal-practice');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
  window.app.init();
});

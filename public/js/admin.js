/**
 * Admin Command Center Controller
 * Controls event configuration, stage parameters, live participant management,
 * CSV score report export, and database resets.
 */

class AdminManager {
  constructor() {
    this.token = sessionStorage.getItem('aarohan_admin_token') || null;
    this.settings = null;
  }

  isLoggedIn() {
    return !!this.token;
  }

  async login(password) {
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');

      this.token = data.token;
      this.settings = data.settings;
      sessionStorage.setItem('aarohan_admin_token', this.token);
      return true;
    } catch (err) {
      alert(err.message);
      return false;
    }
  }

  logout() {
    this.token = null;
    sessionStorage.removeItem('aarohan_admin_token');
    window.location.reload();
  }

  async loadAdminView() {
    if (!this.token) return;

    // Load current config
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      if (data.stages) {
        document.getElementById('cfg-s1-count').value = data.stages.stage1.numbersCount;
        document.getElementById('cfg-s1-disp').value = data.stages.stage1.displayIntervalSeconds;
        document.getElementById('cfg-s1-ans').value = data.stages.stage1.responseIntervalSeconds;

        document.getElementById('cfg-s2-count').value = data.stages.stage2.numbersCount;
        document.getElementById('cfg-s2-disp').value = data.stages.stage2.displayIntervalSeconds;
        document.getElementById('cfg-s2-ans').value = data.stages.stage2.responseIntervalSeconds;

        document.getElementById('cfg-s3-count').value = data.stages.stage3.numbersCount;
        document.getElementById('cfg-s3-disp').value = data.stages.stage3.displayIntervalSeconds;
        document.getElementById('cfg-s3-ans').value = data.stages.stage3.responseIntervalSeconds;
      }
    } catch (e) {
      console.error('Error loading config in admin:', e);
    }

    this.renderAdminMonitor();
    if (window.leaderboardManager) {
      window.leaderboardManager.fetchData();
    }
  }

  async saveConfig() {
    if (!this.token) return;

    const stages = {
      stage1: {
        numbersCount: parseInt(document.getElementById('cfg-s1-count').value),
        displayIntervalSeconds: parseFloat(document.getElementById('cfg-s1-disp').value),
        responseIntervalSeconds: parseFloat(document.getElementById('cfg-s1-ans').value)
      },
      stage2: {
        numbersCount: parseInt(document.getElementById('cfg-s2-count').value),
        displayIntervalSeconds: parseFloat(document.getElementById('cfg-s2-disp').value),
        responseIntervalSeconds: parseFloat(document.getElementById('cfg-s2-ans').value)
      },
      stage3: {
        numbersCount: parseInt(document.getElementById('cfg-s3-count').value),
        displayIntervalSeconds: parseFloat(document.getElementById('cfg-s3-disp').value),
        responseIntervalSeconds: parseFloat(document.getElementById('cfg-s3-ans').value)
      }
    };

    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this.token, stages })
      });
      const data = await res.json();
      if (data.success) {
        window.app.showToast('Stage parameters saved and updated live for all players!', 'success');
        if (window.gameEngine) window.gameEngine.loadConfig();
      } else {
        alert(data.error || 'Failed to save config');
      }
    } catch (e) {
      alert('Error updating configuration');
    }
  }

  renderAdminMonitor() {
    const tbody = document.getElementById('admin-teams-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    const leaderboard = window.leaderboardManager.leaderboardData || [];

    if (leaderboard.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--text-muted);">No teams registered yet.</td></tr>`;
      return;
    }

    leaderboard.forEach(team => {
      if (team.members && team.members.length > 0) {
        team.members.forEach(m => {
          const tr = document.createElement('tr');
          const s1 = m.scores?.stage1 !== null ? m.scores.stage1 : '-';
          const s2 = m.scores?.stage2 !== null ? m.scores.stage2 : '-';
          const s3 = m.scores?.stage3 !== null ? m.scores.stage3 : '-';

          tr.innerHTML = `
            <td>
              <strong>${team.name}</strong><br>
              <span style="font-family:var(--font-mono); font-size:0.75rem; color:var(--accent-cyan);">${team.code}</span>
            </td>
            <td>
              ${m.name} ${m.isLeader ? '<span class="badge-tag">Leader</span>' : ''}<br>
              <span style="font-size:0.78rem; color:var(--text-muted);">${m.phone ? '📞 ' + m.phone : (m.college || '')}</span>
            </td>
            <td><code style="color:#fff;">${m.rollNumber}</code></td>
            <td><span class="badge-status ${m.status}">${m.status}</span></td>
            <td>S1: ${s1} | S2: ${s2} | S3: ${s3} = <strong>${m.scores?.total || 0} pts</strong></td>
            <td>
              <div style="display:flex; gap:6px;">
                <button class="btn btn-secondary btn-sm" onclick="window.adminManager.resetParticipant('${m.rollNumber}')" title="Reset this player's run">
                  ↺ Reset
                </button>
                <button class="btn btn-danger btn-sm" onclick="window.adminManager.deleteTeam('${team.code}')" title="Delete Team">
                  ✕ Delete
                </button>
              </div>
            </td>
          `;
          tbody.appendChild(tr);
        });
      }
    });
  }

  async resetParticipant(rollNumber) {
    if (!confirm(`Are you sure you want to reset participant with Roll Number ${rollNumber}? Their scores will be cleared so they can replay.`)) {
      return;
    }

    try {
      const res = await fetch('/api/admin/reset-participant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this.token, rollNumber })
      });
      const data = await res.json();
      if (data.success) {
        window.app.showToast(data.message, 'success');
        this.renderAdminMonitor();
      } else {
        alert(data.error);
      }
    } catch (e) {
      alert('Error resetting participant');
    }
  }

  async deleteTeam(teamCode) {
    if (!confirm(`Are you sure you want to delete team ${teamCode} and all its participants?`)) {
      return;
    }

    try {
      const res = await fetch('/api/admin/delete-team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this.token, teamCode })
      });
      const data = await res.json();
      if (data.success) {
        window.app.showToast(data.message, 'success');
        this.renderAdminMonitor();
      } else {
        alert(data.error);
      }
    } catch (e) {
      alert('Error deleting team');
    }
  }

  exportCSV() {
    if (!this.token) return;
    window.location.href = `/api/admin/export-csv?token=${encodeURIComponent(this.token)}`;
  }

  async purgeAll() {
    const pwd = prompt('DANGER: This will delete ALL teams, participants, and game scores. Enter Admin Password to confirm:');
    if (!pwd) return;

    try {
      const res = await fetch('/api/admin/reset-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this.token, confirmPassword: pwd })
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message);
        window.location.reload();
      } else {
        alert(data.error);
      }
    } catch (e) {
      alert('Error purging data');
    }
  }
}

window.adminManager = new AdminManager();

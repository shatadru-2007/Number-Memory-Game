/**
 * Live Leaderboard & Audience Module
 * Real-time WebSocket synchronization, stats tracking, and team breakdown inspection.
 */

class LeaderboardManager {
  constructor() {
    this.ws = null;
    this.leaderboardData = [];
    this.stats = { totalTeams: 0, totalParticipants: 0, playingNow: 0, finished: 0 };
    this.searchQuery = '';
    this.expandedTeamCodes = new Set();
  }

  init() {
    this.connectWebSocket();
    this.fetchData();

    // Bind search
    const searchInput = document.getElementById('leaderboard-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.toLowerCase().trim();
        this.renderLeaderboard();
      });
    }
  }

  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = window.BACKEND_WS_URL || `${protocol}//${window.location.host}/ws`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('WebSocket connected for live leaderboard updates');
        if (this.pollInterval) {
          clearInterval(this.pollInterval);
          this.pollInterval = null;
        }
        const pill = document.getElementById('server-status-pill');
        if (pill) {
          pill.innerHTML = `<span class="status-dot"></span> Live Sync Active`;
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'INIT_STATE' || msg.type === 'STATS_UPDATE') {
            this.handleDataUpdate(msg.payload);
          }
        } catch (e) {
          console.error('Error parsing WebSocket message:', e);
        }
      };

      this.ws.onclose = () => {
        console.warn('WebSocket disconnected or unsupported on this host. Falling back to HTTP polling...');
        const pill = document.getElementById('server-status-pill');
        if (pill) {
          pill.innerHTML = `<span class="status-dot" style="background:#ffb703; box-shadow:0 0 10px #ffb703;"></span> Polling Active`;
        }
        if (!this.pollInterval) {
          this.fetchData();
          this.pollInterval = setInterval(() => this.fetchData(), 3000);
        }
      };
    } catch (e) {
      console.error('WebSocket connection error:', e);
      if (!this.pollInterval) {
        this.fetchData();
        this.pollInterval = setInterval(() => this.fetchData(), 3000);
      }
    }
  }

  async fetchData() {
    try {
      const res = await fetch('/api/audience/live');
      const data = await res.json();
      this.handleDataUpdate(data);
    } catch (e) {
      console.error('Error fetching live data:', e);
    }
  }

  handleDataUpdate(data) {
    if (data.stats) {
      this.stats = data.stats;
      this.renderStats();
    }
    if (data.leaderboard) {
      this.leaderboardData = data.leaderboard;
      this.renderLeaderboard();
    }
  }

  renderStats() {
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    setVal('stat-total-teams', this.stats.totalTeams);
    setVal('stat-total-participants', this.stats.totalParticipants);
    setVal('stat-playing-now', this.stats.playingNow);
    setVal('stat-finished', this.stats.finished);
  }

  renderLeaderboard() {
    const tbody = document.getElementById('leaderboard-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    const filtered = this.leaderboardData.filter(team => {
      if (!this.searchQuery) return true;
      const matchName = team.name.toLowerCase().includes(this.searchQuery);
      const matchCode = team.code.toLowerCase().includes(this.searchQuery);
      const matchMember = team.members.some(m => 
        m.name.toLowerCase().includes(this.searchQuery) || 
        m.rollNumber.toLowerCase().includes(this.searchQuery)
      );
      return matchName || matchCode || matchMember;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 40px; color: var(--text-muted);">
            No teams found. Teams will appear here once registered!
          </td>
        </tr>
      `;
      return;
    }

    filtered.forEach((team, index) => {
      const rank = index + 1;
      let rankBadgeClass = 'rank-other';
      let rankText = `#${rank}`;
      if (rank === 1) { rankBadgeClass = 'rank-1'; rankText = '🥇'; }
      else if (rank === 2) { rankBadgeClass = 'rank-2'; rankText = '🥈'; }
      else if (rank === 3) { rankBadgeClass = 'rank-3'; rankText = '🥉'; }

      const isExpanded = this.expandedTeamCodes.has(team.code);

      // Main Team Row
      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      tr.innerHTML = `
        <td><span class="rank-badge ${rankBadgeClass}">${rankText}</span></td>
        <td>
          <div style="font-weight: 700; font-size: 1.05rem;">${team.name}</div>
          <div style="font-size: 0.78rem; font-family: var(--font-mono); color: var(--accent-cyan);">${team.code}</div>
        </td>
        <td>
          <span style="font-size: 0.9rem; color: var(--text-muted);">${team.memberCount} Player${team.memberCount !== 1 ? 's' : ''}</span>
        </td>
        <td>
          <span style="font-family: var(--font-mono); font-size: 1.3rem; font-weight: 800; color: var(--accent-cyan);">${team.totalScore}</span>
          <span style="font-size: 0.8rem; color: var(--text-muted);"> pts</span>
        </td>
        <td style="text-align: right;">
          <button class="btn btn-secondary btn-sm" onclick="window.leaderboardManager.toggleTeamDetails('${team.code}')">
            ${isExpanded ? 'Hide Details ▲' : 'View Breakdown ▼'}
          </button>
        </td>
      `;
      tbody.appendChild(tr);

      // Expandable Details Row
      const detailTr = document.createElement('tr');
      detailTr.className = `member-breakdown-row ${isExpanded ? 'active' : ''}`;
      detailTr.id = `breakdown-${team.code}`;

      let membersHtml = '';
      if (team.members && team.members.length > 0) {
        membersHtml = team.members.map(m => `
          <div class="member-score-chip">
            <h5>
              <span>${m.name} ${m.isLeader ? '<span class="badge-tag">Leader</span>' : ''}</span>
              <span style="color: var(--accent-cyan);">${m.scores?.total || 0} pts</span>
            </h5>
            <div style="font-size: 0.78rem; color: var(--text-dim); margin-bottom: 6px;">
              Roll: <strong>${m.rollNumber}</strong> ${m.phone ? ' | 📞 ' + m.phone : (m.college ? ' | ' + m.college : '')}
            </div>
            <div class="member-stage-scores">
              <span>S1: <strong>${m.scores?.stage1 !== null ? m.scores.stage1 : '-'}</strong></span>
              <span>S2: <strong>${m.scores?.stage2 !== null ? m.scores.stage2 : '-'}</strong></span>
              <span>S3: <strong>${m.scores?.stage3 !== null ? m.scores.stage3 : '-'}</strong></span>
            </div>
          </div>
        `).join('');
      } else {
        membersHtml = '<div style="color: var(--text-muted); font-size: 0.85rem;">No members joined yet.</div>';
      }

      detailTr.innerHTML = `
        <td colspan="5" style="padding: 0;">
          <div class="breakdown-box">
            <div style="font-size: 0.8rem; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em;">
              Team Member Individual Contribution (Sum = Team Total)
            </div>
            <div class="breakdown-cards-grid">
              ${membersHtml}
            </div>
          </div>
        </td>
      `;
      tbody.appendChild(detailTr);
    });

    window.app?.setupTableScrollIndicators();
  }

  toggleTeamDetails(code) {
    if (this.expandedTeamCodes.has(code)) {
      this.expandedTeamCodes.delete(code);
    } else {
      this.expandedTeamCodes.add(code);
    }
    this.renderLeaderboard();
  }
}

window.leaderboardManager = new LeaderboardManager();

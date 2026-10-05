const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data', 'database.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database helper functions with safe file reads and writes
function loadDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initial = {
        settings: {
          stages: {
            stage1: { numbersCount: 5, displayIntervalSeconds: 3.0, responseIntervalSeconds: 5.0 },
            stage2: { numbersCount: 8, displayIntervalSeconds: 2.0, responseIntervalSeconds: 4.0 },
            stage3: { numbersCount: 10, displayIntervalSeconds: 1.5, responseIntervalSeconds: 3.0 }
          },
          adminPassword: 'admin2026'
        },
        teams: [],
        participants: [],
        audience: [],
        gameRuns: []
      };
      fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
      return initial;
    }
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error loading database:', err);
    return { settings: {}, teams: [], participants: [], audience: [], gameRuns: [] };
  }
}

function saveDb(db) {
  try {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (err) {
    console.error('Error saving database:', err);
  }
}

// Generate unique team code (e.g. MEM-4921)
function generateTeamCode(existingTeams) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  let exists = true;
  while (exists) {
    let rand = '';
    for (let i = 0; i < 4; i++) {
      rand += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    code = `MEM-${rand}`;
    exists = existingTeams.some(t => t.code === code);
  }
  return code;
}

// WebSocket broadcast to all connected clients
function broadcast(type, payload) {
  const message = JSON.stringify({ type, payload, timestamp: Date.now() });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function getLiveStats(db) {
  const totalTeams = db.teams.length;
  const totalParticipants = db.participants.length;
  const playingNow = db.participants.filter(p => p.status && p.status.startsWith('playing')).length;
  const finished = db.participants.filter(p => p.status === 'finished').length;

  // Build Leaderboard: Team total score = sum of member total scores
  const leaderboard = db.teams.map(team => {
    const members = db.participants.filter(p => p.teamCode === team.code);
    const calculatedScore = members.reduce((sum, m) => sum + (m.scores?.total || 0), 0);
    return {
      id: team.id,
      name: team.name,
      code: team.code,
      createdAt: team.createdAt,
      totalScore: calculatedScore,
      memberCount: members.length,
      members: members.map(m => ({
        name: m.name,
        rollNumber: m.rollNumber,
        college: m.college,
        isLeader: m.isLeader,
        status: m.status,
        scores: m.scores || { stage1: null, stage2: null, stage3: null, total: 0 }
      }))
    };
  });

  leaderboard.sort((a, b) => b.totalScore - a.totalScore);

  return {
    stats: { totalTeams, totalParticipants, playingNow, finished },
    leaderboard
  };
}

// WebSocket connection handler
wss.on('connection', ws => {
  const db = loadDb();
  const liveData = getLiveStats(db);
  ws.send(JSON.stringify({ type: 'INIT_STATE', payload: liveData }));
});

// ======================== API ROUTES ========================

// 1. Get Game Settings / Stage Config
app.get('/api/config', (req, res) => {
  const db = loadDb();
  res.json({
    stages: db.settings.stages,
    serverTime: Date.now()
  });
});

// 2. Participant: Create Team (Leader)
app.post('/api/participant/create-team', (req, res) => {
  const { teamName, leaderName, rollNumber, email, college } = req.body;

  if (!teamName || !leaderName || !rollNumber || !email) {
    return res.status(400).json({ error: 'Please provide all required fields (Team Name, Name, Roll Number, Email).' });
  }

  const cleanedRoll = String(rollNumber).trim().toUpperCase();
  const db = loadDb();

  // Strict constraint: A student with one roll number cannot register in any other team!
  const existingStudent = db.participants.find(p => p.rollNumber.toUpperCase() === cleanedRoll);
  if (existingStudent) {
    const team = db.teams.find(t => t.code === existingStudent.teamCode);
    const teamNameMsg = team ? team.name : existingStudent.teamCode;
    return res.status(400).json({
      error: `Student with Roll Number "${cleanedRoll}" is already registered in team "${teamNameMsg}" (Code: ${existingStudent.teamCode}). Duplicate registration is not permitted.`
    });
  }

  const teamCode = generateTeamCode(db.teams);
  const now = new Date().toISOString();

  const newTeam = {
    id: 'team_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    name: teamName.trim(),
    code: teamCode,
    leaderRoll: cleanedRoll,
    totalScore: 0,
    createdAt: now
  };

  const leaderParticipant = {
    id: 'part_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    teamCode: teamCode,
    name: leaderName.trim(),
    rollNumber: cleanedRoll,
    email: email.trim().toLowerCase(),
    college: college ? college.trim() : 'N/A',
    isLeader: true,
    status: 'ready',
    scores: { stage1: null, stage2: null, stage3: null, total: 0 },
    joinedAt: now
  };

  db.teams.push(newTeam);
  db.participants.push(leaderParticipant);
  saveDb(db);

  // Broadcast live stats update
  broadcast('STATS_UPDATE', getLiveStats(db));

  res.json({
    success: true,
    team: newTeam,
    participant: leaderParticipant
  });
});

// 3. Participant: Join Existing Team (Teammate)
app.post('/api/participant/join-team', (req, res) => {
  const { teamCode, memberName, rollNumber, email, college } = req.body;

  if (!teamCode || !memberName || !rollNumber || !email) {
    return res.status(400).json({ error: 'Please provide Team Code, Name, Roll Number, and Email.' });
  }

  const cleanedCode = String(teamCode).trim().toUpperCase();
  const cleanedRoll = String(rollNumber).trim().toUpperCase();
  const db = loadDb();

  const team = db.teams.find(t => t.code.toUpperCase() === cleanedCode);
  if (!team) {
    return res.status(404).json({ error: `Team with Code "${cleanedCode}" does not exist. Please check the code with your team leader.` });
  }

  // Strict constraint: One roll number cannot register in any other team
  const existingStudent = db.participants.find(p => p.rollNumber.toUpperCase() === cleanedRoll);
  if (existingStudent) {
    const existingTeam = db.teams.find(t => t.code === existingStudent.teamCode);
    const teamNameMsg = existingTeam ? existingTeam.name : existingStudent.teamCode;
    return res.status(400).json({
      error: `Student with Roll Number "${cleanedRoll}" is already registered in team "${teamNameMsg}" (Code: ${existingStudent.teamCode}). Duplicate registration is not permitted.`
    });
  }

  const now = new Date().toISOString();
  const newMember = {
    id: 'part_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    teamCode: team.code,
    name: memberName.trim(),
    rollNumber: cleanedRoll,
    email: email.trim().toLowerCase(),
    college: college ? college.trim() : 'N/A',
    isLeader: false,
    status: 'ready',
    scores: { stage1: null, stage2: null, stage3: null, total: 0 },
    joinedAt: now
  };

  db.participants.push(newMember);
  saveDb(db);

  broadcast('STATS_UPDATE', getLiveStats(db));

  res.json({
    success: true,
    team,
    participant: newMember
  });
});

// 4. Get Team Details and Member Scores
app.get('/api/team/:teamCode', (req, res) => {
  const code = req.params.teamCode.toUpperCase();
  const db = loadDb();

  const team = db.teams.find(t => t.code.toUpperCase() === code);
  if (!team) {
    return res.status(404).json({ error: 'Team not found' });
  }

  const members = db.participants.filter(p => p.teamCode.toUpperCase() === code);
  const totalScore = members.reduce((sum, m) => sum + (m.scores?.total || 0), 0);

  res.json({
    team: { ...team, totalScore },
    members
  });
});

// 5. Update Participant Status (e.g. playing_stage_1, finished)
app.post('/api/participant/status', (req, res) => {
  const { rollNumber, status } = req.body;
  if (!rollNumber || !status) {
    return res.status(400).json({ error: 'rollNumber and status are required' });
  }

  const db = loadDb();
  const participant = db.participants.find(p => p.rollNumber.toUpperCase() === String(rollNumber).trim().toUpperCase());
  if (!participant) {
    return res.status(404).json({ error: 'Participant not found' });
  }

  participant.status = status;
  participant.lastActive = new Date().toISOString();
  saveDb(db);

  broadcast('STATS_UPDATE', getLiveStats(db));
  res.json({ success: true, participant });
});

// 6. Submit Stage Score
app.post('/api/game/submit-stage', (req, res) => {
  const { rollNumber, teamCode, stageNumber, sequenceShown, sequenceEntered, score } = req.body;

  if (!rollNumber || !stageNumber || score === undefined) {
    return res.status(400).json({ error: 'Missing required stage completion data' });
  }

  const db = loadDb();
  const participant = db.participants.find(p => p.rollNumber.toUpperCase() === String(rollNumber).trim().toUpperCase());
  if (!participant) {
    return res.status(404).json({ error: 'Participant not found' });
  }

  if (!participant.scores) {
    participant.scores = { stage1: null, stage2: null, stage3: null, total: 0 };
  }

  const stageKey = `stage${stageNumber}`;
  participant.scores[stageKey] = Number(score);

  // Recalculate participant total
  const s1 = participant.scores.stage1 || 0;
  const s2 = participant.scores.stage2 || 0;
  const s3 = participant.scores.stage3 || 0;
  participant.scores.total = s1 + s2 + s3;

  if (Number(stageNumber) === 3) {
    participant.status = 'finished';
  } else {
    participant.status = `completed_stage_${stageNumber}`;
  }
  participant.lastActive = new Date().toISOString();

  // Update team total score
  const team = db.teams.find(t => t.code === participant.teamCode);
  if (team) {
    const teamMembers = db.participants.filter(p => p.teamCode === team.code);
    team.totalScore = teamMembers.reduce((sum, m) => sum + (m.scores?.total || 0), 0);
  }

  // Record game run
  db.gameRuns.push({
    id: 'run_' + Date.now(),
    rollNumber: participant.rollNumber,
    teamCode: participant.teamCode,
    stageNumber,
    sequenceShown,
    sequenceEntered,
    score,
    timestamp: new Date().toISOString()
  });

  saveDb(db);

  broadcast('STATS_UPDATE', getLiveStats(db));

  res.json({
    success: true,
    participant,
    teamTotalScore: team ? team.totalScore : participant.scores.total
  });
});

// 7. Audience: Login via Email
app.post('/api/audience/login', (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const db = loadDb();

  let audienceUser = db.audience.find(a => a.email === cleanEmail);
  if (!audienceUser) {
    audienceUser = {
      id: 'aud_' + Date.now(),
      email: cleanEmail,
      loginAt: new Date().toISOString()
    };
    db.audience.push(audienceUser);
    saveDb(db);
  }

  res.json({
    success: true,
    user: audienceUser,
    liveData: getLiveStats(db)
  });
});

// 8. Audience: Get Live Dashboard Data
app.get('/api/audience/live', (req, res) => {
  const db = loadDb();
  res.json(getLiveStats(db));
});

// 9. Admin: Login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const db = loadDb();

  if (password === db.settings.adminPassword) {
    return res.json({
      success: true,
      token: 'admin_session_aarohan_2026',
      settings: db.settings
    });
  }

  res.status(401).json({ error: 'Invalid admin credentials.' });
});

// 10. Admin: Update Stage Config
app.post('/api/admin/config', (req, res) => {
  const { token, stages, adminPassword } = req.body;
  if (token !== 'admin_session_aarohan_2026') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const db = loadDb();
  if (stages) {
    db.settings.stages = stages;
  }
  if (adminPassword) {
    db.settings.adminPassword = adminPassword;
  }
  saveDb(db);

  broadcast('CONFIG_UPDATE', { stages: db.settings.stages });
  res.json({ success: true, settings: db.settings });
});

// 11. Admin: Reset Single Participant Attempt
app.post('/api/admin/reset-participant', (req, res) => {
  const { token, rollNumber } = req.body;
  if (token !== 'admin_session_aarohan_2026') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const db = loadDb();
  const p = db.participants.find(part => part.rollNumber.toUpperCase() === String(rollNumber).trim().toUpperCase());
  if (!p) {
    return res.status(404).json({ error: 'Participant not found' });
  }

  p.scores = { stage1: null, stage2: null, stage3: null, total: 0 };
  p.status = 'ready';

  const team = db.teams.find(t => t.code === p.teamCode);
  if (team) {
    const teamMembers = db.participants.filter(m => m.teamCode === team.code);
    team.totalScore = teamMembers.reduce((sum, m) => sum + (m.scores?.total || 0), 0);
  }

  saveDb(db);
  broadcast('STATS_UPDATE', getLiveStats(db));
  res.json({ success: true, message: `Participant ${p.name} (${p.rollNumber}) has been reset to Ready.` });
});

// 12. Admin: Delete Team
app.post('/api/admin/delete-team', (req, res) => {
  const { token, teamCode } = req.body;
  if (token !== 'admin_session_aarohan_2026') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const db = loadDb();
  db.teams = db.teams.filter(t => t.code !== teamCode);
  db.participants = db.participants.filter(p => p.teamCode !== teamCode);
  saveDb(db);

  broadcast('STATS_UPDATE', getLiveStats(db));
  res.json({ success: true, message: `Team ${teamCode} deleted successfully.` });
});

// 13. Admin: Reset Entire Event
app.post('/api/admin/reset-all', (req, res) => {
  const { token, confirmPassword } = req.body;
  if (token !== 'admin_session_aarohan_2026') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const db = loadDb();
  if (confirmPassword !== db.settings.adminPassword) {
    return res.status(401).json({ error: 'Incorrect confirmation password.' });
  }

  db.teams = [];
  db.participants = [];
  db.gameRuns = [];
  saveDb(db);

  broadcast('STATS_UPDATE', getLiveStats(db));
  res.json({ success: true, message: 'All teams, participants, and game scores have been purged. Fresh event initialized.' });
});

// 14. Admin: Export CSV
app.get('/api/admin/export-csv', (req, res) => {
  const token = req.query.token;
  if (token !== 'admin_session_aarohan_2026') {
    return res.status(403).send('Unauthorized');
  }

  const db = loadDb();
  let csv = 'Team Name,Team Code,Participant Name,Roll Number,Email,College,Is Leader,Status,Stage 1,Stage 2,Stage 3,Player Total,Team Total\n';

  db.teams.forEach(team => {
    const members = db.participants.filter(p => p.teamCode === team.code);
    const teamTotal = members.reduce((sum, m) => sum + (m.scores?.total || 0), 0);

    if (members.length === 0) {
      csv += `"${team.name}","${team.code}","","","","","","","","","","0","${teamTotal}"\n`;
    } else {
      members.forEach(m => {
        const s1 = m.scores?.stage1 !== null && m.scores?.stage1 !== undefined ? m.scores.stage1 : 0;
        const s2 = m.scores?.stage2 !== null && m.scores?.stage2 !== undefined ? m.scores.stage2 : 0;
        const s3 = m.scores?.stage3 !== null && m.scores?.stage3 !== undefined ? m.scores.stage3 : 0;
        const pTotal = m.scores?.total || 0;
        csv += `"${team.name}","${team.code}","${m.name}","${m.rollNumber}","${m.email}","${m.college || ''}","${m.isLeader ? 'YES' : 'NO'}","${m.status}","${s1}","${s2}","${s3}","${pTotal}","${teamTotal}"\n`;
      });
    }
  });

  res.header('Content-Type', 'text/csv');
  res.attachment('aarohan_2026_opencv_memory_game_results.csv');
  res.send(csv);
});

// Serve frontend for all standard routes
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` (DS) OpenCV Memory Game Server Running on Port ${PORT}`);
  console.log(` Local URL: http://localhost:${PORT}`);
  console.log(`=======================================================`);
});

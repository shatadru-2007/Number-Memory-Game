# (DS) OpenCV Memory Game — AAROHAN 2026

An interactive computer vision memory tournament arena engineered for **AAROHAN 2026**.  
Participants memorize sequential numbers flashing rapidly on screen, then reproduce the exact sequence in an **OpenCV Computer Vision Output Box** using real-time hand gestures ($0 \le X \le 9$).

Built following the landing page and authentication procedure of [https://ieee-event-math.onrender.com/](https://ieee-event-math.onrender.com/).

---

## 🌟 Key Architecture & Features

### 1. Landing Page (3 Dedicated Roles / Panels)
- **🧠 Participant Panel**:
  - **Create Team (Leader)**: Enter Team Name, Leader Full Name, Roll Number, Email, and College. The system automatically creates a unique 6-character Team Code (e.g. `MEM-8LK5`).
  - **Join Team (Teammate)**: Enter Team Code, Full Name, Roll Number, Email, and College to join an existing team.
  - **Strict Roll Number Constraint**: A team name can be duplicated, but **a student with one roll number cannot register in any other team**. Any duplicate roll number attempt is immediately blocked with a clear notice showing where they are already registered.
  - **Team Lobby**: Shows team code (with copy button), team roster, player statuses (`ready`, `playing_stage_1/2/3`, `finished`), individual stage breakdowns, and total team score.
  - **Camera Calibration Mode**: Allows players to test their webcam and practice hand gestures for digits 0 to 9 before their scored attempt.
- **👥 Audience Panel**:
  - Instant sign-in via **Email ID only** (no password required).
  - **4 Live Metric Cards**: Total Teams, Total Participants, Playing Now, Finished.
  - **Live Dynamic Leaderboard**: Ranked by total team points with real-time WebSocket sync.
  - **Expandable Team Breakdown**: Click **View Breakdown** on any team to view individual team members, their roll numbers, Stage 1, Stage 2, and Stage 3 points.
- **🛡️ Admin / Host Panel**:
  - Secure login with Host Password (default: `admin2026`).
  - **Stage Parameters Tuner**: Live adjustment of numbers count, display intervals, and answer response time windows for Stage 1, Stage 2, and Stage 3.
  - **Live Participant Monitor Table**: View and search all registered participants with ability to **Reset** an individual player's run (in case of camera glitch/browser reload) or **Delete** a team.
  - **Export Official Results to CSV**: One-click download of `aarohan_2026_opencv_memory_game_results.csv` with full student data, roll numbers, stage scores, and team totals.
  - **Purge / Reset Event**: Securely clear all teams and participants for a fresh competition round.

---

## 🎮 Game Rules & Stage Progression

| Stage | Numbers Count | Display Interval | Answer Time Window | Max Score |
| :--- | :---: | :---: | :---: | :---: |
| **Stage 1** | 5 Numbers ($0 \le X \le 9$) | 3.0 seconds per number | 5.0 seconds per answer | 5 Points |
| **Stage 2** | 8 Numbers ($0 \le X \le 9$) | 2.0 seconds per number | 4.0 seconds per answer | 8 Points |
| **Stage 3** | 10 Numbers ($0 \le X \le 9$) | 1.5 seconds per number | 3.0 seconds per answer | 10 Points |

### Scoring & Judging Criteria:
- **Individual Score**: Each stage, the number of correctly recalled numbers in their exact sequential order awards 1 point each.
- **Team Score**: Each player plays individually, and the **team's score is the exact sum of all team members' scores**.
- **Winner**: The team with the maximum accumulated points wins the tournament.

---

## 🖐️ Hand Gesture Encoding ($0 \le X \le 9$)

Gestures are detected via computer vision (MediaPipe Hands landmark mesh + OpenCV):
- **`0`**: Closed fist (0 extended fingers)
- **`1` to `5`**: 1 to 5 extended fingers on one hand (Thumb, Index, Middle, Ring, Pinky)
- **`6` to `9`**: Open hand (5 fingers on one hand) + 1 to 4 fingers on the other hand (or total extended fingers across both hands = 6, 7, 8, 9)

> **Accessibility / Backup**: The OpenCV Vision HUD also features a "Confirm Digit" button and keyboard numeric keys (`0` to `9`) as a fallback.

---

## 🚀 Quick Start Guide

### 1. Launch the Web Application (Node.js)
```bash
# In the project directory:
npm start
# OR
node server.js
```
Open your browser at:  
👉 **`http://localhost:3000`**

### 2. Run the Standalone Desktop Python OpenCV Engine (Optional)
If you wish to run the interactive OpenCV camera window directly in Python:
```bash
python opencv_vision_engine.py
```
- Opens an OpenCV 60-FPS camera feed with real-time hand skeleton overlay and HUD.
- Runs through the 3-stage memory sequence on desktop with audio cues and keyboard/gesture controls.
- Press `q` anytime to exit.

---

## 📁 Repository Structure

```
├── server.js                   # Express + WebSocket server & REST APIs
├── package.json                # Project dependencies
├── opencv_vision_engine.py     # Python OpenCV + MediaPipe desktop game engine
├── data/
│   └── database.json           # Atomic JSON database (teams, participants, runs, settings)
├── public/
│   ├── index.html              # Modern dark-mode SPA with 3 panels & Game Arena
│   ├── css/
│   │   └── style.css           # Glassmorphism, neon HUD, responsive layout & animations
│   └── js/
│       ├── app.js              # Orchestrator, view router, modals & forms
│       ├── audio.js            # Zero-latency Web Audio API synthesizer
│       ├── vision.js           # Client-side MediaPipe Hands + OpenCV HUD renderer
│       ├── game.js             # 3-stage memory sequencer, timer loop & scoring engine
│       ├── leaderboard.js      # WebSocket live leaderboard & audience analytics
│       └── admin.js            # Host command center & CSV exporter
└── README.md                   # Documentation
```

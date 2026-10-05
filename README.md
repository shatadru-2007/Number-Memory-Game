# (DS) OpenCV Memory Game — AAROHAN 2026

An interactive computer vision memory tournament arena engineered for **AAROHAN 2026**.  
Participants memorize sequential numbers flashing prominently on screen, then reproduce the exact sequence in an **OpenCV Vision Arena** using real-time hand gestures ($0 \le X \le 9$).

Built following the competition protocol and landing page aesthetics of [https://ieee-event-math.onrender.com/](https://ieee-event-math.onrender.com/).

---

## 🌟 Key Architecture & Features

### 1. Landing Page (2 Dedicated Roles / Panels)
- **🧠 Participant Panel**:
  - **Create Team (Leader)**: Enter Team Name, Leader Full Name, Roll Number, Email, and Phone Number. The system automatically generates a unique 6-character Team Code (e.g. `MEM-8LK5`).
  - **Join Team (Teammate)**: Enter Team Code, Full Name, Roll Number, Email, and Phone Number to join an existing team.
  - **Strict Roll Number Constraint**: A team name can be duplicated, but **a student with one roll number cannot register in any other team**. Any duplicate roll number attempt is immediately blocked with a clear notice showing where they are already registered.
  - **Private Team Lobby**: Participants **only see the scores and roster of their own team**. Shows team code (with copy button), team roster, player statuses (`ready`, `playing_stage_1/2/3`, `finished`), individual stage breakdowns, and total team score.
  - **Camera Calibration Mode**: Allows players to test their webcam and practice hand gestures for digits 1 to 9 before their scored attempt.
- **🛡️ Admin / Host Panel**:
  - Secure login with Host Password (default: `admin2026`).
  - **Restricted Tournament Leaderboard & Live Telemetry**: The full tournament leaderboard and the 4 live event statistics (Total Teams, Total Participants, Playing Now, Finished) are **strictly restricted to Admin view**.
  - **Stage Parameters Tuner**: Live adjustment of numbers count, display intervals, and answer response time windows for Stage 1, Stage 2, and Stage 3.
  - **Live Participant Monitor Table**: View and search all registered participants with ability to **Reset** an individual player's run (in case of camera glitch/browser reload) or **Delete** a team.
  - **Export Official Results to CSV**: One-click download of `aarohan_2026_opencv_memory_game_results.csv` with full student data, roll numbers, stage scores, and team totals.
  - **Purge / Reset Event**: Securely clear all teams and participants for a fresh competition round.

---

## 🎮 Game Arena & Vision Interface

### 1. Memorization Phase
- **Prominent Sequence Position**: Header displays the exact slot number being shown (e.g. `SEQUENCE NUMBER 3 OF 5`) with visual step tracking pills for the entire stage sequence.
- **Ultra-Prominent Glowing Digit Display**: Massive, high-contrast glowing digit circle.
- **Interval Window Timer Bar**: Smooth countdown filling/depleting for each number.

### 2. Gesture Detection Answering Phase (Split Layout)
- **Top Right Corner**: Compact live OpenCV Camera View powered by MediaPipe Hands landmark mesh.
- **Bottom Right Corner**: Grid of sequence numbers for that specific stage:
  - Active position glows cyan.
  - **Green (✓)**: Awarded when the participant presents the correct number!
  - **Red (✗)**: Indicated if the timer expires with a wrong number.
- **Central Part (Main Focus)**:
  - **Top**: Prominently shows current sequence number (e.g. `SHOW SEQUENCE #2 OF 5`).
  - **Below that**: Prominent digital countdown timer with urgent/warning visual pulses.
  - **Below that**: Detected gesture digit clearly rendered in **extra large, glowing size**.
- **No Threshold Delay**:
  - As soon as the correct number is detected, it is immediately marked correct (slot turns green) and advances to the next number.
  - If the correct answer is not shown, the timer runs down to `0.0s`. At `0.0s`, the last detected gesture digit is submitted and advances.

---

## 🖐️ Hand Gesture Encoding ($0 \le X \le 9$)

Gestures are detected via computer vision (MediaPipe Hands landmark mesh + OpenCV):
- **`0`**: Closed fist (0 extended fingers)
- **`1` to `5`**: 1 to 5 extended fingers on one hand (Thumb, Index, Middle, Ring, Pinky)
- **`6` to `9`**: Open hand (5 fingers on one hand) + 1 to 4 fingers on the other hand (or total extended fingers across both hands = 6, 7, 8, 9)

> **Accessibility / Backup**: The OpenCV Vision HUD also features a "Confirm Current Digit" button and keyboard numeric keys (`0` to `9`) as an instant fallback.

---

## ☁️ Deploying & Hosting on Render

This project is pre-configured for **Render** (`render.yaml`, `Procfile`, and lightweight `requirements.txt`).

### Method 1: Deploy with Git / GitHub (Recommended)

1. **Push your code to GitHub**:
   ```bash
   git add .
   git commit -m "Configure Number Memory Game for Render deployment"
   git push origin main
   ```

2. **Open Render Dashboard**:
   - Go to [dashboard.render.com](https://dashboard.render.com/) and click **New +** > **Web Service**.
   - Connect your GitHub repository (`Number-Memory-Game`).

3. **Configure the Web Service Settings**:
   | Field | Setting |
   | :--- | :--- |
   | **Name** | `aarohan-number-memory` (or any custom name) |
   | **Region** | Choose the closest region (e.g., Singapore, Frankfurt, Oregon) |
   | **Branch** | `main` |
   | **Runtime** | `Python` |
   | **Build Command** | `pip install -r requirements.txt` |
   | **Start Command** | `python server.py` |
   | **Instance Type** | `Free` |

4. **Environment Variables**:
   Under **Advanced** > **Environment Variables**, add:
   - `PORT` = `10000` (Render binds automatically)
   - `ADMIN_PASSWORD` = `admin2026` (or your chosen host secret)
   - `HOST` = `0.0.0.0`

5. **Health Check Path**:
   Set Health Check Path to:
   - `/api/health`

6. Click **Create Web Service**!  
   Render will install dependencies, launch `server.py`, and provide an HTTPS URL (e.g. `https://aarohan-number-memory.onrender.com`).

---

### Method 2: Deploy Using Render Blueprint (`render.yaml`)

Render supports 1-click Blueprints from the included `render.yaml` file:
1. In Render Dashboard, click **New +** > **Blueprint**.
2. Select your repository.
3. Render reads `render.yaml` automatically, provisions the service, sets environment variables and the health check path.
4. Click **Apply** to deploy!

---

## 💻 Running Locally

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Start the Local Server
```bash
python server.py
```
Open your browser at `http://localhost:3000`.

### 3. Run Automated Tests
```bash
python test_server.py
```

### 4. Standalone Desktop Python Script (Optional)
If you wish to run the local desktop camera window via OpenCV CLI:
```bash
pip install -r requirements-desktop.txt
python opencv_vision_engine.py --offline
```

---

## 📁 Repository Structure

```
├── server.py                   # Async Python server (aiohttp, REST APIs, WebSockets, static file serving)
├── test_server.py              # Automated test suite (6 passing unit tests)
├── requirements.txt            # Render deployment dependencies (pure python aiohttp)
├── requirements-desktop.txt    # Desktop standalone OpenCV dependencies
├── render.yaml                 # Render Blueprint specification
├── Procfile                    # Render/Heroku process definition
├── .python-version             # Python version specification (3.11.9)
├── public/
│   ├── index.html              # Main HTML: Landing page, Team Lobby, Split Screen Arena, Admin Center
│   ├── css/
│   │   └── style.css           # Premium cyber-themed UI styles & split-screen responsive layouts
│   └── js/
│       ├── app.js              # Application orchestrator & view controller
│       ├── audio.js            # Sound effects engine (Web Audio API synthesizers)
│       ├── vision.js           # Client-side MediaPipe landmarking & finger-counting
│       ├── game.js             # 3-stage game engine, sequence generation, instant advance
│       ├── leaderboard.js      # WebSocket sync & leaderboard manager (Admin view)
│       └── admin.js            # Admin panel controls, CSV export, stage config
└── data/
    └── database.json           # Lightweight local JSON database for teams & participants
```

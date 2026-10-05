#!/usr/bin/env python3
"""
(DS) OpenCV Memory Game - Python Backend Server
AAROHAN 2026 - Data Science Arena / IEEE Event Architecture

Replaces the Node.js Express/WebSocket backend with a high-performance,
native Python asynchronous server powered by aiohttp.

Features:
- Real-time WebSocket broadcasting for live leaderboard and state sync
- REST API for Participants (Team Creation, Teammate Joining, Score Submission)
- REST API for Audience (Email authentication, Live tournament analytics)
- REST API for Host/Admin (Config tuning, player reset, CSV export, event purge)
- Static file serving for modern dark-mode glassmorphic web interface
"""

import os
import sys
import json
import time
import random
import string
import asyncio
import io
import csv
from datetime import datetime, timezone
from pathlib import Path
from aiohttp import web, WSMsgType

# Base Directories
BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = BASE_DIR / "public"
DATA_DIR = BASE_DIR / "data"
DB_FILE = DATA_DIR / "database.json"

PORT = int(os.environ.get("PORT", 3000))
HOST = os.environ.get("HOST", "0.0.0.0")

# Concurrency lock for database reads and writes
db_lock = asyncio.Lock()

# Set of connected WebSocket clients
connected_websockets = set()


# ======================== DATABASE HELPERS ========================

def get_default_db():
    return {
        "settings": {
            "stages": {
                "stage1": {
                    "numbersCount": 5,
                    "displayIntervalSeconds": 3.0,
                    "responseIntervalSeconds": 5.0
                },
                "stage2": {
                    "numbersCount": 8,
                    "displayIntervalSeconds": 2.0,
                    "responseIntervalSeconds": 4.0
                },
                "stage3": {
                    "numbersCount": 10,
                    "displayIntervalSeconds": 1.5,
                    "responseIntervalSeconds": 3.0
                }
            },
            "adminPassword": "admin2026"
        },
        "teams": [],
        "participants": [],
        "audience": [],
        "gameRuns": []
    }


def load_db():
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        if not DB_FILE.exists():
            initial = get_default_db()
            save_db(initial)
            return initial
        with open(DB_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            # Ensure essential keys exist
            if "settings" not in data:
                data["settings"] = get_default_db()["settings"]
            if "teams" not in data:
                data["teams"] = []
            if "participants" not in data:
                data["participants"] = []
            if "audience" not in data:
                data["audience"] = []
            if "gameRuns" not in data:
                data["gameRuns"] = []
            return data
    except Exception as err:
        print(f"[ERROR] Failed to load database: {err}", file=sys.stderr)
        return get_default_db()


def save_db(db):
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        temp_file = DATA_DIR / f"database_{time.time_ns()}.tmp"
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(db, f, indent=2, ensure_ascii=False)
        temp_file.replace(DB_FILE)
    except Exception as err:
        print(f"[ERROR] Failed to save database: {err}", file=sys.stderr)


def generate_team_code(existing_teams):
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    while True:
        rand = "".join(random.choices(chars, k=4))
        code = f"MEM-{rand}"
        if not any(t.get("code") == code for t in existing_teams):
            return code


def get_live_stats(db):
    teams = db.get("teams", [])
    participants = db.get("participants", [])

    total_teams = len(teams)
    total_participants = len(participants)
    playing_now = sum(
        1 for p in participants
        if (p.get("status") or "").startswith("playing")
    )
    finished = sum(
        1 for p in participants
        if p.get("status") == "finished"
    )

    leaderboard = []
    for team in teams:
        team_code = team.get("code", "")
        members = [p for p in participants if p.get("teamCode") == team_code]
        calculated_score = sum(
            (m.get("scores") or {}).get("total", 0) for m in members
        )
        leaderboard.append({
            "id": team.get("id"),
            "name": team.get("name"),
            "code": team_code,
            "createdAt": team.get("createdAt"),
            "totalScore": calculated_score,
            "memberCount": len(members),
            "members": [
                {
                    "name": m.get("name"),
                    "rollNumber": m.get("rollNumber"),
                    "college": m.get("college"),
                    "isLeader": m.get("isLeader", False),
                    "status": m.get("status"),
                    "scores": m.get("scores") or {
                        "stage1": None,
                        "stage2": None,
                        "stage3": None,
                        "total": 0
                    }
                }
                for m in members
            ]
        })

    leaderboard.sort(key=lambda x: x["totalScore"], reverse=True)

    return {
        "stats": {
            "totalTeams": total_teams,
            "totalParticipants": total_participants,
            "playingNow": playing_now,
            "finished": finished
        },
        "leaderboard": leaderboard
    }


# ======================== WEBSOCKET BROADCASTER ========================

async def broadcast(event_type, payload):
    if not connected_websockets:
        return
    msg = json.dumps({
        "type": event_type,
        "payload": payload,
        "timestamp": int(time.time() * 1000)
    })
    stale = []
    for ws in list(connected_websockets):
        try:
            if not ws.closed:
                await ws.send_str(msg)
            else:
                stale.append(ws)
        except Exception:
            stale.append(ws)
    for ws in stale:
        connected_websockets.discard(ws)


async def websocket_handler(request):
    ws = web.WebSocketResponse(heartbeat=30.0)
    await ws.prepare(request)

    connected_websockets.add(ws)

    # Immediately dispatch current live state to newly connected client
    try:
        async with db_lock:
            db = load_db()
            init_state = get_live_stats(db)
        await ws.send_str(json.dumps({
            "type": "INIT_STATE",
            "payload": init_state,
            "timestamp": int(time.time() * 1000)
        }))
    except Exception as e:
        print(f"[WS] Error sending INIT_STATE: {e}", file=sys.stderr)

    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                # Handle client ping or custom message if needed
                pass
            elif msg.type == WSMsgType.ERROR:
                print(f"[WS] Connection error: {ws.exception()}", file=sys.stderr)
    finally:
        connected_websockets.discard(ws)

    return ws


# ======================== MIDDLEWARES ========================

@web.middleware
async def cors_middleware(request, handler):
    if request.method == "OPTIONS":
        response = web.Response(status=204)
    else:
        response = await handler(request)

    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With"
    return response


# ======================== REST API ROUTES ========================

# 1. Config / Game Stages
async def api_get_config(request):
    async with db_lock:
        db = load_db()
        return web.json_response({
            "stages": db["settings"]["stages"],
            "serverTime": int(time.time() * 1000)
        })


# 2. Participant: Create Team (Leader)
async def api_participant_create_team(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)

    team_name = body.get("teamName")
    leader_name = body.get("leaderName")
    roll_number = body.get("rollNumber")
    email = body.get("email")
    college = body.get("college")

    if not team_name or not leader_name or not roll_number or not email:
        return web.json_response({
            "error": "Please provide all required fields (Team Name, Name, Roll Number, Email)."
        }, status=400)

    cleaned_roll = str(roll_number).strip().upper()

    async with db_lock:
        db = load_db()

        # Strict constraint: A student with one roll number cannot register in any other team!
        existing_student = next(
            (p for p in db["participants"] if str(p.get("rollNumber", "")).upper() == cleaned_roll),
            None
        )
        if existing_student:
            team = next((t for t in db["teams"] if t.get("code") == existing_student.get("teamCode")), None)
            team_msg = team.get("name") if team else existing_student.get("teamCode")
            return web.json_response({
                "error": f'Student with Roll Number "{cleaned_roll}" is already registered in team "{team_msg}" (Code: {existing_student.get("teamCode")}). Duplicate registration is not permitted.'
            }, status=400)

        team_code = generate_team_code(db["teams"])
        now = datetime.now(timezone.utc).isoformat()
        rand_suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=4))

        new_team = {
            "id": f"team_{int(time.time() * 1000)}_{rand_suffix}",
            "name": str(team_name).strip(),
            "code": team_code,
            "leaderRoll": cleaned_roll,
            "totalScore": 0,
            "createdAt": now
        }

        leader_participant = {
            "id": f"part_{int(time.time() * 1000)}_{rand_suffix}",
            "teamCode": team_code,
            "name": str(leader_name).strip(),
            "rollNumber": cleaned_roll,
            "email": str(email).strip().lower(),
            "college": str(college).strip() if college else "N/A",
            "isLeader": True,
            "status": "ready",
            "scores": {"stage1": None, "stage2": None, "stage3": None, "total": 0},
            "joinedAt": now
        }

        db["teams"].append(new_team)
        db["participants"].append(leader_participant)
        save_db(db)
        live_stats = get_live_stats(db)

    await broadcast("STATS_UPDATE", live_stats)

    return web.json_response({
        "success": True,
        "team": new_team,
        "participant": leader_participant
    })


# 3. Participant: Join Existing Team (Teammate)
async def api_participant_join_team(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)

    team_code = body.get("teamCode")
    member_name = body.get("memberName")
    roll_number = body.get("rollNumber")
    email = body.get("email")
    college = body.get("college")

    if not team_code or not member_name or not roll_number or not email:
        return web.json_response({
            "error": "Please provide Team Code, Name, Roll Number, and Email."
        }, status=400)

    cleaned_code = str(team_code).strip().upper()
    cleaned_roll = str(roll_number).strip().upper()

    async with db_lock:
        db = load_db()

        team = next((t for t in db["teams"] if str(t.get("code", "")).upper() == cleaned_code), None)
        if not team:
            return web.json_response({
                "error": f'Team with Code "{cleaned_code}" does not exist. Please check the code with your team leader.'
            }, status=404)

        # Strict constraint: One roll number cannot register in any other team
        existing_student = next(
            (p for p in db["participants"] if str(p.get("rollNumber", "")).upper() == cleaned_roll),
            None
        )
        if existing_student:
            existing_team = next((t for t in db["teams"] if t.get("code") == existing_student.get("teamCode")), None)
            team_msg = existing_team.get("name") if existing_team else existing_student.get("teamCode")
            return web.json_response({
                "error": f'Student with Roll Number "{cleaned_roll}" is already registered in team "{team_msg}" (Code: {existing_student.get("teamCode")}). Duplicate registration is not permitted.'
            }, status=400)

        now = datetime.now(timezone.utc).isoformat()
        rand_suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=4))

        new_member = {
            "id": f"part_{int(time.time() * 1000)}_{rand_suffix}",
            "teamCode": team.get("code"),
            "name": str(member_name).strip(),
            "rollNumber": cleaned_roll,
            "email": str(email).strip().lower(),
            "college": str(college).strip() if college else "N/A",
            "isLeader": False,
            "status": "ready",
            "scores": {"stage1": None, "stage2": None, "stage3": None, "total": 0},
            "joinedAt": now
        }

        db["participants"].append(new_member)
        save_db(db)
        live_stats = get_live_stats(db)

    await broadcast("STATS_UPDATE", live_stats)

    return web.json_response({
        "success": True,
        "team": team,
        "participant": new_member
    })


# 4. Get Team Details and Member Scores
async def api_get_team_details(request):
    code = request.match_info.get("teamCode", "").strip().upper()
    async with db_lock:
        db = load_db()
        team = next((t for t in db["teams"] if str(t.get("code", "")).upper() == code), None)
        if not team:
            return web.json_response({"error": "Team not found"}, status=404)

        members = [p for p in db["participants"] if str(p.get("teamCode", "")).upper() == code]
        total_score = sum((m.get("scores") or {}).get("total", 0) for m in members)

        return web.json_response({
            "team": {**team, "totalScore": total_score},
            "members": members
        })


# 5. Update Participant Status
async def api_update_participant_status(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)

    roll_number = body.get("rollNumber")
    status = body.get("status")

    if not roll_number or not status:
        return web.json_response({"error": "rollNumber and status are required"}, status=400)

    cleaned_roll = str(roll_number).strip().upper()

    async with db_lock:
        db = load_db()
        participant = next(
            (p for p in db["participants"] if str(p.get("rollNumber", "")).upper() == cleaned_roll),
            None
        )
        if not participant:
            return web.json_response({"error": "Participant not found"}, status=404)

        participant["status"] = status
        participant["lastActive"] = datetime.now(timezone.utc).isoformat()
        save_db(db)
        live_stats = get_live_stats(db)

    await broadcast("STATS_UPDATE", live_stats)

    return web.json_response({
        "success": True,
        "participant": participant
    })


# 6. Submit Stage Score
async def api_submit_stage_score(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)

    roll_number = body.get("rollNumber")
    stage_number = body.get("stageNumber")
    score = body.get("score")
    sequence_shown = body.get("sequenceShown")
    sequence_entered = body.get("sequenceEntered")

    if not roll_number or stage_number is None or score is None:
        return web.json_response({"error": "Missing required stage completion data"}, status=400)

    cleaned_roll = str(roll_number).strip().upper()

    async with db_lock:
        db = load_db()
        participant = next(
            (p for p in db["participants"] if str(p.get("rollNumber", "")).upper() == cleaned_roll),
            None
        )
        if not participant:
            return web.json_response({"error": "Participant not found"}, status=404)

        if not participant.get("scores"):
            participant["scores"] = {"stage1": None, "stage2": None, "stage3": None, "total": 0}

        stage_key = f"stage{stage_number}"
        participant["scores"][stage_key] = int(score) if isinstance(score, (int, float)) else score

        s1 = participant["scores"].get("stage1") or 0
        s2 = participant["scores"].get("stage2") or 0
        s3 = participant["scores"].get("stage3") or 0
        participant["scores"]["total"] = s1 + s2 + s3

        if int(stage_number) == 3:
            participant["status"] = "finished"
        else:
            participant["status"] = f"completed_stage_{stage_number}"

        participant["lastActive"] = datetime.now(timezone.utc).isoformat()

        # Update team total score
        team = next((t for t in db["teams"] if t.get("code") == participant.get("teamCode")), None)
        if team:
            team_members = [p for p in db["participants"] if p.get("teamCode") == team.get("code")]
            team["totalScore"] = sum((m.get("scores") or {}).get("total", 0) for m in team_members)

        # Record game run history
        db["gameRuns"].append({
            "id": f"run_{int(time.time() * 1000)}",
            "rollNumber": participant.get("rollNumber"),
            "teamCode": participant.get("teamCode"),
            "stageNumber": stage_number,
            "sequenceShown": sequence_shown,
            "sequenceEntered": sequence_entered,
            "score": score,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })

        save_db(db)
        live_stats = get_live_stats(db)

    await broadcast("STATS_UPDATE", live_stats)

    return web.json_response({
        "success": True,
        "participant": participant,
        "teamTotalScore": team.get("totalScore") if team else participant["scores"]["total"]
    })


# 7. Audience: Login via Email
async def api_audience_login(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)

    email = body.get("email")
    if not email or "@" not in email:
        return web.json_response({"error": "Please provide a valid email address."}, status=400)

    clean_email = str(email).strip().lower()

    async with db_lock:
        db = load_db()
        audience_user = next((a for a in db["audience"] if a.get("email") == clean_email), None)
        if not audience_user:
            audience_user = {
                "id": f"aud_{int(time.time() * 1000)}",
                "email": clean_email,
                "loginAt": datetime.now(timezone.utc).isoformat()
            }
            db["audience"].append(audience_user)
            save_db(db)

        live_data = get_live_stats(db)

    return web.json_response({
        "success": True,
        "user": audience_user,
        "liveData": live_data
    })


# 8. Audience: Get Live Dashboard Data
async def api_audience_live(request):
    async with db_lock:
        db = load_db()
        return web.json_response(get_live_stats(db))


# 9. Admin: Login
async def api_admin_login(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)

    password = body.get("password")
    async with db_lock:
        db = load_db()
        admin_pass = db.get("settings", {}).get("adminPassword", "admin2026")

        if password == admin_pass:
            return web.json_response({
                "success": True,
                "token": "admin_session_aarohan_2026",
                "settings": db["settings"]
            })

    return web.json_response({"error": "Invalid admin credentials."}, status=401)


# 10. Admin: Update Stage Config
async def api_admin_config(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)

    token = body.get("token")
    if token != "admin_session_aarohan_2026":
        return web.json_response({"error": "Unauthorized"}, status=403)

    stages = body.get("stages")
    admin_password = body.get("adminPassword")

    async with db_lock:
        db = load_db()
        if stages:
            db["settings"]["stages"] = stages
        if admin_password:
            db["settings"]["adminPassword"] = admin_password
        save_db(db)
        updated_settings = db["settings"]

    await broadcast("CONFIG_UPDATE", {"stages": updated_settings["stages"]})

    return web.json_response({
        "success": True,
        "settings": updated_settings
    })


# 11. Admin: Reset Single Participant Attempt
async def api_admin_reset_participant(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)

    token = body.get("token")
    if token != "admin_session_aarohan_2026":
        return web.json_response({"error": "Unauthorized"}, status=403)

    roll_number = body.get("rollNumber")
    cleaned_roll = str(roll_number).strip().upper()

    async with db_lock:
        db = load_db()
        p = next((x for x in db["participants"] if str(x.get("rollNumber", "")).upper() == cleaned_roll), None)
        if not p:
            return web.json_response({"error": "Participant not found"}, status=404)

        p["scores"] = {"stage1": None, "stage2": None, "stage3": None, "total": 0}
        p["status"] = "ready"

        team = next((t for t in db["teams"] if t.get("code") == p.get("teamCode")), None)
        if team:
            team_members = [m for m in db["participants"] if m.get("teamCode") == team.get("code")]
            team["totalScore"] = sum((m.get("scores") or {}).get("total", 0) for m in team_members)

        save_db(db)
        live_stats = get_live_stats(db)

    await broadcast("STATS_UPDATE", live_stats)

    return web.json_response({
        "success": True,
        "message": f'Participant {p.get("name")} ({p.get("rollNumber")}) has been reset to Ready.'
    })


# 12. Admin: Delete Team
async def api_admin_delete_team(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)

    token = body.get("token")
    if token != "admin_session_aarohan_2026":
        return web.json_response({"error": "Unauthorized"}, status=403)

    team_code = body.get("teamCode")

    async with db_lock:
        db = load_db()
        db["teams"] = [t for t in db["teams"] if t.get("code") != team_code]
        db["participants"] = [p for p in db["participants"] if p.get("teamCode") != team_code]
        save_db(db)
        live_stats = get_live_stats(db)

    await broadcast("STATS_UPDATE", live_stats)

    return web.json_response({
        "success": True,
        "message": f"Team {team_code} deleted successfully."
    })


# 13. Admin: Reset Entire Event
async def api_admin_reset_all(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)

    token = body.get("token")
    if token != "admin_session_aarohan_2026":
        return web.json_response({"error": "Unauthorized"}, status=403)

    confirm_password = body.get("confirmPassword")

    async with db_lock:
        db = load_db()
        if confirm_password != db.get("settings", {}).get("adminPassword"):
            return web.json_response({"error": "Incorrect confirmation password."}, status=401)

        db["teams"] = []
        db["participants"] = []
        db["gameRuns"] = []
        save_db(db)
        live_stats = get_live_stats(db)

    await broadcast("STATS_UPDATE", live_stats)

    return web.json_response({
        "success": True,
        "message": "All teams, participants, and game scores have been purged. Fresh event initialized."
    })


# 14. Admin: Export CSV
async def api_admin_export_csv(request):
    token = request.query.get("token")
    if token != "admin_session_aarohan_2026":
        return web.Response(text="Unauthorized", status=403)

    async with db_lock:
        db = load_db()

    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)
    writer.writerow([
        "Team Name", "Team Code", "Participant Name", "Roll Number", "Email",
        "College", "Is Leader", "Status", "Stage 1", "Stage 2", "Stage 3",
        "Player Total", "Team Total"
    ])

    for team in db.get("teams", []):
        members = [p for p in db.get("participants", []) if p.get("teamCode") == team.get("code")]
        team_total = sum((m.get("scores") or {}).get("total", 0) for m in members)

        if not members:
            writer.writerow([
                team.get("name", ""), team.get("code", ""),
                "", "", "", "", "", "", "", "", "", 0, team_total
            ])
        else:
            for m in members:
                scores = m.get("scores") or {}
                s1 = scores.get("stage1") if scores.get("stage1") is not None else 0
                s2 = scores.get("stage2") if scores.get("stage2") is not None else 0
                s3 = scores.get("stage3") if scores.get("stage3") is not None else 0
                p_total = scores.get("total", 0)
                writer.writerow([
                    team.get("name", ""),
                    team.get("code", ""),
                    m.get("name", ""),
                    m.get("rollNumber", ""),
                    m.get("email", ""),
                    m.get("college", ""),
                    "YES" if m.get("isLeader") else "NO",
                    m.get("status", ""),
                    s1,
                    s2,
                    s3,
                    p_total,
                    team_total
                ])

    csv_data = output.getvalue()
    return web.Response(
        body=csv_data.encode("utf-8"),
        content_type="text/csv",
        headers={
            "Content-Disposition": 'attachment; filename="aarohan_2026_opencv_memory_game_results.csv"'
        }
    )


# ======================== STATIC & SPA ROUTING ========================

async def root_or_spa_handler(request):
    # Check if this request is a WebSocket upgrade request
    if request.headers.get("Upgrade", "").lower() == "websocket":
        return await websocket_handler(request)

    path = request.match_info.get("tail", "")
    target = PUBLIC_DIR / path if path else PUBLIC_DIR / "index.html"

    if target.is_file():
        return web.FileResponse(target)

    # SPA Fallback: serve index.html for unrecognized non-API routes
    index_file = PUBLIC_DIR / "index.html"
    if index_file.is_file():
        return web.FileResponse(index_file)

    return web.Response(text="Frontend index.html not found.", status=404)


# ======================== HEALTH CHECK (RENDER) ========================

async def api_health(request):
    """Zero-overhead healthcheck route for cloud hosting platforms like Render."""
    return web.json_response({
        "status": "healthy",
        "service": "aarohan-number-memory",
        "timestamp": datetime.now(timezone.utc).isoformat()
    })


# ======================== APPLICATION SETUP ========================

def create_app():
    app = web.Application(middlewares=[cors_middleware])

    # Health check for Render / Cloud
    app.router.add_get("/api/health", api_health)

    # WebSocket endpoints
    app.router.add_get("/ws", websocket_handler)

    # REST APIs
    app.router.add_get("/api/config", api_get_config)
    app.router.add_post("/api/participant/create-team", api_participant_create_team)
    app.router.add_post("/api/participant/join-team", api_participant_join_team)
    app.router.add_get("/api/team/{teamCode}", api_get_team_details)
    app.router.add_post("/api/participant/status", api_update_participant_status)
    app.router.add_post("/api/game/submit-stage", api_submit_stage_score)
    app.router.add_post("/api/audience/login", api_audience_login)
    app.router.add_get("/api/audience/live", api_audience_live)
    app.router.add_post("/api/admin/login", api_admin_login)
    app.router.add_post("/api/admin/config", api_admin_config)
    app.router.add_post("/api/admin/reset-participant", api_admin_reset_participant)
    app.router.add_post("/api/admin/delete-team", api_admin_delete_team)
    app.router.add_post("/api/admin/reset-all", api_admin_reset_all)
    app.router.add_get("/api/admin/export-csv", api_admin_export_csv)

    # Static CSS and JS routes
    css_dir = PUBLIC_DIR / "css"
    if css_dir.is_dir():
        app.router.add_static("/css/", path=str(css_dir), name="css")
    js_dir = PUBLIC_DIR / "js"
    if js_dir.is_dir():
        app.router.add_static("/js/", path=str(js_dir), name="js")

    # Root & Fallback SPA handler
    app.router.add_get("/", root_or_spa_handler)
    app.router.add_get("/{tail:.*}", root_or_spa_handler)

    return app


def main():
    print("=" * 65)
    print(" (DS) OpenCV Memory Game - Python Backend Server")
    print(f" AAROHAN 2026 Tech Fest Arena | Running on Port {PORT}")
    print(f" Local Web Arena: http://localhost:{PORT}")
    print(" Real-time WebSocket live sync: Active")
    print("=" * 65)

    # Ensure DB is loaded / created
    load_db()

    app = create_app()
    web.run_app(app, host=HOST, port=PORT, access_log=None)


if __name__ == "__main__":
    main()

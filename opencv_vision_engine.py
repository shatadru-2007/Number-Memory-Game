"""
(DS) OpenCV Memory Game - Desktop Computer Vision Engine
AAROHAN 2026 - Interactive Hand Gesture Memory Arena

Features:
- Real-time hand landmark tracking with MediaPipe Tasks / Solutions & OpenCV
- Gesture detection for numbers 0 <= X <= 9:
  * 0: Closed fist (0 extended fingers)
  * 1-5: 1 to 5 extended fingers on one hand
  * 6-9: Open hand (5) + 1-4 fingers on second hand (or total extended fingers = 6..9)
- Real-time tournament sync with Python server (http://localhost:3000)
- Fallback keyboard controls (keys '0'-'9') and offline practice mode
"""

import os
import sys
import time
import json
import random
import math
import urllib.request
import urllib.error
from pathlib import Path

import cv2
import numpy as np

# Landmark Indices
TIP_IDS = [4, 8, 12, 16, 20]
PIP_IDS = [2, 6, 10, 14, 18]

HAND_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),
    (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12),
    (9, 13), (13, 14), (14, 15), (15, 16),
    (13, 17), (0, 17), (17, 18), (18, 19), (19, 20)
]

MODEL_PATH = Path(__file__).resolve().parent / "hand_landmarker.task"
MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"


def ensure_model_file():
    """Ensures hand_landmarker.task exists, downloading if necessary."""
    if not MODEL_PATH.exists():
        print(f"[INFO] Downloading hand landmark model from Google CDN...")
        try:
            urllib.request.urlretrieve(MODEL_URL, str(MODEL_PATH))
            print(f"[INFO] Model downloaded successfully to {MODEL_PATH}")
        except Exception as e:
            print(f"[WARN] Failed to auto-download model: {e}")


class HandDetectorWrapper:
    """Wrapper supporting both MediaPipe 1.0+ (Tasks) and legacy MediaPipe (solutions)."""
    def __init__(self):
        self.mode = None
        self.detector = None

        # 1. Try MediaPipe Tasks (MediaPipe 1.0+)
        try:
            import mediapipe as mp
            from mediapipe.tasks.python import BaseOptions
            from mediapipe.tasks.python.vision import HandLandmarker, HandLandmarkerOptions, RunningMode

            ensure_model_file()
            if MODEL_PATH.exists():
                options = HandLandmarkerOptions(
                    base_options=BaseOptions(model_asset_path=str(MODEL_PATH)),
                    running_mode=RunningMode.IMAGE,
                    num_hands=2,
                    min_hand_detection_confidence=0.6,
                    min_hand_presence_confidence=0.5,
                    min_tracking_confidence=0.5
                )
                self.detector = HandLandmarker.create_from_options(options)
                self.mp = mp
                self.mode = "tasks"
                print("[VISION] Using MediaPipe 1.0+ Tasks Hand Landmarker")
                return
        except Exception as e:
            print(f"[VISION] Tasks API not available: {e}")

        # 2. Try Legacy MediaPipe solutions (MediaPipe 0.9/0.10)
        try:
            import mediapipe as mp
            if hasattr(mp, "solutions") and hasattr(mp.solutions, "hands"):
                self.mp_hands = mp.solutions.hands
                self.detector = self.mp_hands.Hands(
                    max_num_hands=2,
                    min_detection_confidence=0.6,
                    min_tracking_confidence=0.5
                )
                self.mode = "legacy"
                print("[VISION] Using Legacy MediaPipe Solutions")
                return
        except Exception as e:
            print(f"[VISION] Legacy API not available: {e}")

        print("[WARN] MediaPipe hand tracker unavailable. Keyboard fallback ('0'-'9') will be active.")
        self.mode = "fallback"

    def process(self, frame_bgr):
        """Processes frame and returns list of (landmarks_list, handedness_label)."""
        if self.mode == "tasks":
            rgb_frame = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            mp_image = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=rgb_frame)
            results = self.detector.detect(mp_image)

            hands_output = []
            if results.hand_landmarks:
                for idx, lms in enumerate(results.hand_landmarks):
                    label = "Right"
                    if results.handedness and idx < len(results.handedness):
                        label = results.handedness[idx][0].category_name
                    hands_output.append((lms, label))
            return hands_output

        elif self.mode == "legacy":
            rgb_frame = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            results = self.detector.process(rgb_frame)
            hands_output = []
            if results.multi_hand_landmarks:
                for idx, hand_lms in enumerate(results.multi_hand_landmarks):
                    label = "Right"
                    if results.multi_handedness and idx < len(results.multi_handedness):
                        label = results.multi_handedness[idx].classification[0].label
                    hands_output.append((hand_lms.landmark, label))
            return hands_output

        return []


def count_extended_fingers(landmarks, handedness_label):
    """Counts extended fingers for a single hand."""
    fingers = []

    thumb_tip = landmarks[TIP_IDS[0]]
    thumb_ip = landmarks[TIP_IDS[0] - 1]

    # Mirrored camera view
    if handedness_label == 'Right':
        if thumb_tip.x < thumb_ip.x:
            fingers.append(1)
        else:
            fingers.append(0)
    else:
        if thumb_tip.x > thumb_ip.x:
            fingers.append(1)
        else:
            fingers.append(0)

    # 4 Fingers (Index, Middle, Ring, Pinky)
    for i in range(1, 5):
        tip_y = landmarks[TIP_IDS[i]].y
        pip_y = landmarks[PIP_IDS[i]].y
        if tip_y < pip_y:
            fingers.append(1)
        else:
            fingers.append(0)

    return sum(fingers), fingers


def get_gesture_digit(hands_data):
    """
    Detects digit 0 <= X <= 9:
    - 0: Fist (0 fingers extended)
    - 1 to 5: Fingers on one hand
    - 6 to 9: Sum across both hands
    """
    if not hands_data:
        return None, 0, []

    total_fingers = 0
    hands_detail = []

    for landmarks, label in hands_data:
        count, up_list = count_extended_fingers(landmarks, label)
        total_fingers += count
        hands_detail.append((label, count))

    digit = min(total_fingers, 9)
    return digit, total_fingers, hands_detail


def draw_hand_mesh(frame, landmarks):
    """Draws stylish cyber-neon hand skeleton overlay."""
    h, w, _ = frame.shape
    coords = [(int(lm.x * w), int(lm.y * h)) for lm in landmarks]

    # Connections
    for p1_idx, p2_idx in HAND_CONNECTIONS:
        if p1_idx < len(coords) and p2_idx < len(coords):
            cv2.line(frame, coords[p1_idx], coords[p2_idx], (0, 245, 212), 2)

    # Joints
    for pt in coords:
        cv2.circle(frame, pt, 5, (255, 120, 0), -1)
        cv2.circle(frame, pt, 2, (255, 255, 255), -1)


def draw_hud(frame, state, digit_detected, hold_progress, timer_left, current_step, total_steps, stage_num, is_holding_correct=False):
    """Draws prominent high-visibility HUD on the OpenCV frame."""
    h, w, _ = frame.shape

    # Top Header Bar Background
    cv2.rectangle(frame, (0, 0), (w, 100), (12, 18, 30), -1)
    cv2.line(frame, (0, 100), (w, 100), (0, 245, 212), 2)

    # Prominent Target Position & Ordinal
    step_info = f"SHOW POSITION #{current_step} OF {total_steps}"
    cv2.putText(frame, step_info, (25, 42), cv2.FONT_HERSHEY_DUPLEX, 0.95, (0, 245, 212), 2)
    
    stage_sub = f"Stage {stage_num} Sequence Recall · Hold correct answer for 0.5s to advance"
    cv2.putText(frame, stage_sub, (25, 78), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (160, 175, 200), 1)

    # Prominent Timer Display (Right side)
    timer_color = (0, 245, 212)
    if timer_left <= 1.5:
        timer_color = (0, 0, 255) # Red
    elif timer_left <= 2.5:
        timer_color = (0, 180, 255) # Amber

    timer_str = f"{timer_left:.1f}s"
    cv2.putText(frame, "TIME LEFT", (w - 240, 36), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (160, 175, 200), 1)
    cv2.putText(frame, timer_str, (w - 240, 80), cv2.FONT_HERSHEY_DUPLEX, 1.3, timer_color, 2)

    # Bottom Overlay Bar
    cv2.rectangle(frame, (0, h - 90), (w, h), (12, 18, 30), -1)
    cv2.line(frame, (0, h - 90), (w, h - 90), (0, 245, 212), 2)

    # Detected Digit Box
    det_text = f"DETECTED: {digit_detected if digit_detected is not None else '--'}"
    cv2.putText(frame, det_text, (30, h - 38), cv2.FONT_HERSHEY_DUPLEX, 1.0, (0, 255, 128), 2)

    # Hold status / criteria text and bar
    if is_holding_correct:
        status_txt = f"CORRECT NUMBER! HOLDING {hold_progress * 0.5:.1f}s / 0.5s"
        cv2.putText(frame, status_txt, (w // 2 - 180, h - 60), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 128), 2)
        bar_w = int(300 * min(hold_progress, 1.0))
        cv2.rectangle(frame, (w // 2 - 150, h - 45), (w // 2 + 150, h - 25), (50, 50, 50), -1)
        cv2.rectangle(frame, (w // 2 - 150, h - 45), (w // 2 - 150 + bar_w, h - 25), (0, 255, 128), -1)
    else:
        status_txt = "Hold correct gesture for 0.5s or timer will auto-submit final gesture"
        cv2.putText(frame, status_txt, (w // 2 - 250, h - 38), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (180, 180, 180), 1)


# ======================== PYTHON SERVER SYNC HELPERS ========================

def fetch_server_config(server_url="http://localhost:3000"):
    """Fetches real-time stage parameters from the Python backend server."""
    try:
        req = urllib.request.Request(f"{server_url}/api/config")
        with urllib.request.urlopen(req, timeout=2.0) as res:
            if res.status == 200:
                data = json.loads(res.read().decode("utf-8"))
                return data.get("stages")
    except Exception:
        return None


def submit_score_to_server(roll_number, stage_num, sequence, user_sequence, score, server_url="http://localhost:3000"):
    """Submits stage score to the Python backend server."""
    try:
        payload = json.dumps({
            "rollNumber": roll_number,
            "stageNumber": stage_num,
            "sequenceShown": sequence,
            "sequenceEntered": user_sequence,
            "score": score
        }).encode("utf-8")
        req = urllib.request.Request(
            f"{server_url}/api/game/submit-stage",
            data=payload,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=3.0) as res:
            if res.status == 200:
                return json.loads(res.read().decode("utf-8"))
    except Exception as e:
        print(f"[SYNC] Could not sync score with server: {e}")
    return None


def update_server_status(roll_number, status, server_url="http://localhost:3000"):
    """Updates participant playing status on server."""
    try:
        payload = json.dumps({
            "rollNumber": roll_number,
            "status": status
        }).encode("utf-8")
        req = urllib.request.Request(
            f"{server_url}/api/participant/status",
            data=payload,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=2.0) as res:
            pass
    except Exception:
        pass


# ======================== GAME LOOP ========================

def run_opencv_standalone_game(roll_number=None, server_url="http://localhost:3000"):
    """Runs full interactive OpenCV memory game directly on desktop webcam with optional server sync."""
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("[ERROR] Cannot access webcam! Please check camera connection or permissions.")
        return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

    # Attempt to load dynamic stage config from server if available
    remote_stages = fetch_server_config(server_url) if server_url else None
    if remote_stages:
        print("[INFO] Synced real-time stage configuration from Python Server!")
        s1 = remote_stages.get("stage1", {})
        s2 = remote_stages.get("stage2", {})
        s3 = remote_stages.get("stage3", {})
        stages = [
            {"stage": 1, "count": s1.get("numbersCount", 5), "display_time": float(s1.get("displayIntervalSeconds", 3.0)), "answer_time": float(s1.get("responseIntervalSeconds", 5.0))},
            {"stage": 2, "count": s2.get("numbersCount", 8), "display_time": float(s2.get("displayIntervalSeconds", 2.0)), "answer_time": float(s2.get("responseIntervalSeconds", 4.0))},
            {"stage": 3, "count": s3.get("numbersCount", 10), "display_time": float(s3.get("displayIntervalSeconds", 1.5)), "answer_time": float(s3.get("responseIntervalSeconds", 3.0))},
        ]
    else:
        stages = [
            {"stage": 1, "count": 5, "display_time": 3.0, "answer_time": 5.0},
            {"stage": 2, "count": 8, "display_time": 2.0, "answer_time": 4.0},
            {"stage": 3, "count": 10, "display_time": 1.5, "answer_time": 3.0},
        ]

    total_game_score = 0
    stage_scores = []

    detector = HandDetectorWrapper()

    print("\n=======================================================")
    print(" AAROHAN 2026 - (DS) OPENCV MEMORY GAME (DESKTOP MODE) ")
    print(" 0: Fist | 1-5: Fingers on one hand | 6-9: Both hands  ")
    if roll_number:
        print(f" Synced Participant Roll: {roll_number}")
    else:
        print(" Mode: Offline Practice")
    print(" Fallback: Keyboard keys '0' to '9'")
    print(" Press 'q' anytime to exit.                            ")
    print("=======================================================\n")

    for stage_info in stages:
        stage_num = stage_info["stage"]
        count = stage_info["count"]
        disp_time = stage_info["display_time"]
        ans_time = stage_info["answer_time"]

        if roll_number:
            update_server_status(roll_number, f"playing_stage_{stage_num}", server_url)

        # Generate sequence of random numbers (0 to 9)
        sequence = [random.randint(0, 9) for _ in range(count)]
        print(f"\n--- STAGE {stage_num}: Memorize {count} numbers ({disp_time}s each) ---")

        # 1. Countdown to Memorization Phase
        for c in range(3, 0, -1):
            ret, frame = cap.read()
            if not ret: break
            frame = cv2.flip(frame, 1)
            h, w, _ = frame.shape
            cv2.rectangle(frame, (0, 0), (w, h), (15, 12, 28), -1)
            cv2.putText(frame, f"STAGE {stage_num} STARTING IN", (w//2 - 250, h//2 - 60), cv2.FONT_HERSHEY_DUPLEX, 1.2, (0, 245, 212), 2)
            cv2.putText(frame, str(c), (w//2 - 30, h//2 + 60), cv2.FONT_HERSHEY_DUPLEX, 3.5, (0, 200, 255), 4)
            cv2.imshow("OpenCV Memory Game - AAROHAN 2026", frame)
            cv2.waitKey(1000)

        # 2. Display Numbers One by One
        for idx, num in enumerate(sequence):
            start_num_time = time.time()
            while time.time() - start_num_time < disp_time:
                ret, frame = cap.read()
                if not ret: break
                frame = cv2.flip(frame, 1)
                h, w, _ = frame.shape

                # Modern dark overlay
                overlay = frame.copy()
                cv2.rectangle(overlay, (0, 0), (w, h), (15, 12, 28), -1)
                cv2.addWeighted(overlay, 0.85, frame, 0.15, 0, frame)

                # Header
                cv2.putText(frame, f"STAGE {stage_num} - MEMORIZE THE SEQUENCE", (w//2 - 300, 100), cv2.FONT_HERSHEY_DUPLEX, 1.0, (0, 245, 212), 2)
                cv2.putText(frame, f"Number {idx + 1} of {count}", (w//2 - 120, 170), cv2.FONT_HERSHEY_DUPLEX, 0.9, (200, 200, 200), 2)

                # Giant Number Display
                cv2.circle(frame, (w//2, h//2 + 30), 120, (255, 120, 0), -1)
                cv2.circle(frame, (w//2, h//2 + 30), 125, (0, 245, 212), 4)
                cv2.putText(frame, str(num), (w//2 - 40, h//2 + 75), cv2.FONT_HERSHEY_DUPLEX, 4.0, (255, 255, 255), 6)

                # Time left progress bar
                elapsed = time.time() - start_num_time
                prog = 1.0 - (elapsed / disp_time)
                cv2.rectangle(frame, (w//2 - 200, h - 120), (w//2 + 200, h - 90), (40, 40, 40), -1)
                cv2.rectangle(frame, (w//2 - 200, h - 120), (w//2 - 200 + int(400 * prog), h - 90), (0, 245, 212), -1)

                cv2.imshow("OpenCV Memory Game - AAROHAN 2026", frame)
                if cv2.waitKey(20) & 0xFF == ord('q'):
                    cap.release()
                    cv2.destroyAllWindows()
                    return

        # 3. Answering Phase (Hand Gestures via OpenCV)
        user_sequence = []
        for step in range(count):
            expected_num = sequence[step]
            step_start = time.time()
            last_detected = None
            correct_hold_start = None
            hold_progress = 0.0

            while True:
                time_left = max(0.0, ans_time - (time.time() - step_start))
                if time_left <= 0:
                    # Timer expired! User did NOT hold correct answer for 0.5s
                    # "The number at the last should be considered as answer then."
                    locked_digit = last_detected if last_detected is not None else 0
                    user_sequence.append(locked_digit)
                    break

                ret, frame = cap.read()
                if not ret: break
                frame = cv2.flip(frame, 1)

                # Process hand landmarks
                hands_data = detector.process(frame)
                current_digit = None

                if hands_data:
                    current_digit, total_f, details = get_gesture_digit(hands_data)
                    for landmarks, _ in hands_data:
                        draw_hand_mesh(frame, landmarks)

                if current_digit is not None:
                    last_detected = current_digit

                # 0.5s Correct Answer Hold Rule
                is_holding_correct = (current_digit is not None and current_digit == expected_num)
                if is_holding_correct:
                    if correct_hold_start is None:
                        correct_hold_start = time.time()
                    hold_duration = time.time() - correct_hold_start
                    hold_progress = min(hold_duration / 0.5, 1.0)
                    if hold_duration >= 0.5:
                        # User held correct answer for 0.5s! Lock in early and advance!
                        user_sequence.append(expected_num)
                        break
                else:
                    correct_hold_start = None
                    hold_progress = 0.0

                draw_hud(frame, "ANSWERING", current_digit, hold_progress, time_left, step + 1, count, stage_num, is_holding_correct)
                cv2.imshow("OpenCV Memory Game - AAROHAN 2026", frame)

                key = cv2.waitKey(20) & 0xFF
                if key == ord('q'):
                    cap.release()
                    cv2.destroyAllWindows()
                    return
                elif ord('0') <= key <= ord('9'):
                    user_sequence.append(int(chr(key)))
                    break

        # Calculate Score for this Stage
        stage_score = sum(1 for a, b in zip(sequence, user_sequence) if a == b)
        stage_scores.append(stage_score)
        total_game_score += stage_score

        if roll_number:
            print(f"[SYNC] Submitting Stage {stage_num} score ({stage_score}/{count}) to server...")
            submit_score_to_server(roll_number, stage_num, sequence, user_sequence, stage_score, server_url)

        # Show Stage Results Screen
        result_start = time.time()
        while time.time() - result_start < 4.0:
            ret, frame = cap.read()
            if not ret: break
            frame = cv2.flip(frame, 1)
            h, w, _ = frame.shape
            cv2.rectangle(frame, (0, 0), (w, h), (15, 12, 28), -1)

            cv2.putText(frame, f"STAGE {stage_num} COMPLETED!", (w//2 - 250, 100), cv2.FONT_HERSHEY_DUPLEX, 1.2, (0, 245, 212), 2)
            cv2.putText(frame, f"Original:  {' '.join(map(str, sequence))}", (w//2 - 250, 200), cv2.FONT_HERSHEY_DUPLEX, 0.9, (255, 255, 255), 2)
            cv2.putText(frame, f"Your Input: {' '.join(map(str, user_sequence))}", (w//2 - 250, 260), cv2.FONT_HERSHEY_DUPLEX, 0.9, (0, 200, 255), 2)

            score_txt = f"Stage Score: {stage_score} / {count} Points"
            cv2.putText(frame, score_txt, (w//2 - 250, 360), cv2.FONT_HERSHEY_DUPLEX, 1.2, (0, 255, 128), 3)

            cv2.imshow("OpenCV Memory Game - AAROHAN 2026", frame)
            if cv2.waitKey(30) & 0xFF == ord('q'):
                break

    if roll_number:
        update_server_status(roll_number, "finished", server_url)

    # Final Overall Results
    print("\n=======================================================")
    print(f" GAME COMPLETED! Total Score: {total_game_score} Points")
    for s_idx, sc in enumerate(stage_scores, 1):
        print(f" - Stage {s_idx}: {sc} Points")
    print("=======================================================\n")

    cap.release()
    cv2.destroyAllWindows()


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description="(DS) OpenCV Memory Game - AAROHAN 2026")
    parser.add_argument("--roll", help="Your registered Roll Number for live tournament leaderboard sync", default=None)
    parser.add_argument("--server", help="Server URL (default: http://localhost:3000)", default="http://localhost:3000")
    parser.add_argument("--offline", action="store_true", help="Play in offline practice mode without syncing")
    args = parser.parse_args()

    roll = args.roll
    if not args.offline and not roll:
        try:
            user_input = input("Enter your registered Roll Number for live tournament sync (or press Enter for Offline mode): ").strip()
            if user_input:
                roll = user_input
        except (EOFError, KeyboardInterrupt):
            pass

    run_opencv_standalone_game(roll_number=roll, server_url=args.server)

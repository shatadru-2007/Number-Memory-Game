"""
(DS) OpenCV Memory Game - Desktop Computer Vision Engine
AAROHAN 2026 - Interactive Hand Gesture Memory Arena

Features:
- Real-time hand landmark tracking with MediaPipe & OpenCV
- Gesture detection for numbers 0 <= X <= 9:
  * 0: Closed fist (0 extended fingers)
  * 1-5: 1 to 5 extended fingers on one hand
  * 6-9: Open hand (5) + 1-4 fingers on second hand (or total extended fingers = 6..9)
- Full 3-Stage Memory Game in pure OpenCV window or sync with Web Server
"""

import cv2
import mediapipe as mp
import time
import random
import math
import sys

# MediaPipe Hands initialization
mp_hands = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils
mp_drawing_styles = mp.solutions.drawing_styles

# Finger tip and pip indices
TIP_IDS = [4, 8, 12, 16, 20]
PIP_IDS = [2, 6, 10, 14, 18]

def count_extended_fingers(landmarks, handedness_label):
    """
    Counts extended fingers for a single hand landmarks set.
    Returns: (count, list_of_fingers_up)
    """
    fingers = []

    # Thumb: Check X coordinate depending on Left or Right hand
    # Note: When looking at camera (mirror mode), handedness may be inverted or direct
    # For robust thumb detection, compare thumb tip with IP/MCP joint distance
    thumb_tip = landmarks[TIP_IDS[0]]
    thumb_ip = landmarks[TIP_IDS[0] - 1]
    thumb_mcp = landmarks[TIP_IDS[0] - 2]
    wrist = landmarks[0]

    # Vector distance from wrist or horizontal offset
    # If mirrored, Right hand thumb moves left when open
    if handedness_label == 'Right':
        if thumb_tip.x < thumb_ip.x:
            fingers.append(1)
        else:
            fingers.append(0)
    else: # Left hand
        if thumb_tip.x > thumb_ip.x:
            fingers.append(1)
        else:
            fingers.append(0)

    # 4 Fingers (Index, Middle, Ring, Pinky): Check if tip is above PIP joint (y is smaller)
    for i in range(1, 5):
        tip_y = landmarks[TIP_IDS[i]].y
        pip_y = landmarks[PIP_IDS[i]].y
        if tip_y < pip_y:
            fingers.append(1)
        else:
            fingers.append(0)

    return sum(fingers), fingers

def get_gesture_digit(multi_hand_landmarks, multi_handedness):
    """
    Detects digit 0 <= X <= 9 based on single or two hands.
    - 0: Fist (0 fingers extended)
    - 1 to 5: Fingers on one hand
    - 6 to 9: Open hand (5) + fingers on second hand (or sum across both hands = 6..9)
    """
    if not multi_hand_landmarks:
        return None, 0, []

    total_fingers = 0
    hands_detail = []

    for idx, hand_lms in enumerate(multi_hand_landmarks):
        label = multi_handedness[idx].classification[0].label
        count, up_list = count_extended_fingers(hand_lms.landmark, label)
        total_fingers += count
        hands_detail.append((label, count))

    # Cap digit at 9
    digit = min(total_fingers, 9)
    return digit, total_fingers, hands_detail

def draw_hud(frame, state, digit_detected, hold_progress, timer_left, current_step, total_steps, stage_num):
    """Draws high-tech cybernetic HUD onto the OpenCV frame."""
    h, w, _ = frame.shape

    # Top Header Bar
    cv2.rectangle(frame, (0, 0), (w, 80), (15, 12, 28), -1)
    cv2.line(frame, (0, 80), (w, 80), (255, 150, 0), 2)

    title = f"(DS) OpenCV Memory Game | STAGE {stage_num}"
    cv2.putText(frame, title, (25, 45), cv2.FONT_HERSHEY_DUPLEX, 0.9, (0, 245, 212), 2)

    step_info = f"Input {current_step}/{total_steps}"
    cv2.putText(frame, step_info, (w - 220, 45), cv2.FONT_HERSHEY_DUPLEX, 0.8, (255, 255, 255), 2)

    # Bottom Overlay Bar
    cv2.rectangle(frame, (0, h - 100), (w, h), (15, 12, 28), -1)
    cv2.line(frame, (0, h - 100), (w, h - 100), (255, 150, 0), 2)

    # Detected Digit Box
    det_text = f"DETECTED: {digit_detected if digit_detected is not None else '--'}"
    cv2.putText(frame, det_text, (30, h - 45), cv2.FONT_HERSHEY_DUPLEX, 1.1, (0, 255, 128), 2)

    # Timer circle or bar
    timer_str = f"Time: {timer_left:.1f}s"
    cv2.putText(frame, timer_str, (w - 250, h - 45), cv2.FONT_HERSHEY_DUPLEX, 0.9, (0, 200, 255), 2)

    # Hold progress bar
    if hold_progress > 0:
        bar_w = int(200 * min(hold_progress, 1.0))
        cv2.rectangle(frame, (w // 2 - 100, h - 60), (w // 2 + 100, h - 40), (60, 60, 60), -1)
        cv2.rectangle(frame, (w // 2 - 100, h - 60), (w // 2 - 100 + bar_w, h - 40), (0, 255, 0), -1)
        cv2.putText(frame, "HOLD TO LOCK", (w // 2 - 65, h - 70), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)

def run_opencv_standalone_game():
    """Runs full interactive OpenCV memory game directly on desktop webcam."""
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("[ERROR] Cannot access webcam! Please check camera connection or permissions.")
        return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

    stages = [
        {"stage": 1, "count": 5, "display_time": 3.0, "answer_time": 5.0},
        {"stage": 2, "count": 8, "display_time": 2.0, "answer_time": 4.0},
        {"stage": 3, "count": 10, "display_time": 1.5, "answer_time": 3.0},
    ]

    total_game_score = 0
    stage_scores = []

    hands = mp_hands.Hands(
        max_num_hands=2,
        min_detection_confidence=0.7,
        min_tracking_confidence=0.6
    )

    print("\n=======================================================")
    print(" AAROHAN 2026 - (DS) OPENCV MEMORY GAME (DESKTOP MODE) ")
    print(" 0: Fist | 1-5: Fingers on one hand | 6-9: Both hands  ")
    print(" Press 'q' anytime to exit.                            ")
    print("=======================================================\n")

    for stage_info in stages:
        stage_num = stage_info["stage"]
        count = stage_info["count"]
        disp_time = stage_info["display_time"]
        ans_time = stage_info["answer_time"]

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
            step_start = time.time()
            last_detected = None
            stable_start = None
            hold_progress = 0.0

            while True:
                time_left = ans_time - (time.time() - step_start)
                if time_left <= 0:
                    # Time out - lock whatever was currently detected or 0
                    locked_digit = last_detected if last_detected is not None else 0
                    user_sequence.append(locked_digit)
                    break

                ret, frame = cap.read()
                if not ret: break
                frame = cv2.flip(frame, 1)

                # Process hand landmarks
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                results = hands.process(rgb)

                current_digit = None
                if results.multi_hand_landmarks:
                    current_digit, total_f, details = get_gesture_digit(results.multi_hand_landmarks, results.multi_handedness)

                    # Draw landmarks on frame
                    for hand_landmarks in results.multi_hand_landmarks:
                        mp_drawing.draw_landmarks(
                            frame,
                            hand_landmarks,
                            mp_hands.HAND_CONNECTIONS,
                            mp_drawing_styles.get_default_hand_landmarks_style(),
                            mp_drawing_styles.get_default_hand_connections_style()
                        )

                # Check stability / hold for 0.8 seconds to confirm
                if current_digit is not None:
                    if current_digit == last_detected:
                        if stable_start is None:
                            stable_start = time.time()
                        hold_duration = time.time() - stable_start
                        hold_progress = hold_duration / 0.8
                        if hold_duration >= 0.8:
                            user_sequence.append(current_digit)
                            break
                    else:
                        last_detected = current_digit
                        stable_start = time.time()
                        hold_progress = 0.0
                else:
                    last_detected = None
                    stable_start = None
                    hold_progress = 0.0

                draw_hud(frame, "ANSWERING", current_digit, hold_progress, time_left, step + 1, count, stage_num)
                cv2.imshow("OpenCV Memory Game - AAROHAN 2026", frame)

                key = cv2.waitKey(20) & 0xFF
                if key == ord('q'):
                    cap.release()
                    cv2.destroyAllWindows()
                    return
                # Optional keyboard override (0-9)
                elif ord('0') <= key <= ord('9'):
                    user_sequence.append(int(chr(key)))
                    break

        # Calculate Score for this Stage
        stage_score = sum(1 for a, b in zip(sequence, user_sequence) if a == b)
        stage_scores.append(stage_score)
        total_game_score += stage_score

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

    # Final Overall Results
    print("\n=======================================================")
    print(f" GAME COMPLETED! Total Score: {total_game_score} Points")
    for s_idx, sc in enumerate(stage_scores, 1):
        print(f" - Stage {s_idx}: {sc} Points")
    print("=======================================================\n")

    cap.release()
    cv2.destroyAllWindows()

if __name__ == '__main__':
    run_opencv_standalone_game()

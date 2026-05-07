"""
Encode faces from crop coordinates.
Input: JSON on stdin — { "image_path": "...", "faces": [{"x":..,"y":..,"w":..,"h":..}, ...] }
Output: JSON array of 128-float arrays (one per face), or null if encoding failed for that face.
"""
import sys
import json
import face_recognition
import numpy as np
from PIL import Image

def encode_faces(image_path, face_boxes):
    img = face_recognition.load_image_file(image_path)
    img_h, img_w = img.shape[:2]

    # Convert {x,y,w,h} to face_recognition format: (top, right, bottom, left)
    locations = []
    for box in face_boxes:
        x, y, w, h = box['x'], box['y'], box['w'], box['h']
        top = max(0, int(y))
        right = min(img_w, int(x + w))
        bottom = min(img_h, int(y + h))
        left = max(0, int(x))
        locations.append((top, right, bottom, left))

    encodings = face_recognition.face_encodings(img, locations)

    results = []
    for i, loc in enumerate(locations):
        if i < len(encodings):
            results.append(encodings[i].tolist())
        else:
            results.append(None)
    return results

if __name__ == '__main__':
    data = json.loads(sys.stdin.read())
    result = encode_faces(data['image_path'], data['faces'])
    print(json.dumps(result))

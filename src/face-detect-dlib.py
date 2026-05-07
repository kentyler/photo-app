"""
Python bridge for dlib/face_recognition.
Called by Node.js via child_process.
Input: image path as argv[1]
Output: JSON array of {box:{x,y,w,h}, descriptor:[128 floats]}
"""
import sys
import json
import face_recognition

def detect(image_path):
    image = face_recognition.load_image_file(image_path)
    locations = face_recognition.face_locations(image, number_of_times_to_upsample=2, model='hog')
    encodings = face_recognition.face_encodings(image, locations)

    faces = []
    for (top, right, bottom, left), encoding in zip(locations, encodings):
        faces.append({
            'box': {
                'x': float(left),
                'y': float(top),
                'w': float(right - left),
                'h': float(bottom - top),
            },
            'descriptor': encoding.tolist(),
        })
    return faces

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('[]')
        sys.exit(0)
    result = detect(sys.argv[1])
    print(json.dumps(result))

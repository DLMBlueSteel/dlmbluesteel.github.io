import sys
import asyncio
import json
from shazamio import Shazam

async def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No file path provided"}))
        return

    file_path = sys.argv[1]
    shazam = Shazam()
    try:
        out = await shazam.recognize(file_path)
        if 'track' in out and out['track']:
            track = out['track']
            title = track.get('title', '')
            artist = track.get('subtitle', '')
            print(json.dumps({"title": title, "artist": artist}))
        else:
            print(json.dumps({"error": "No match found"}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == '__main__':
    asyncio.run(main())

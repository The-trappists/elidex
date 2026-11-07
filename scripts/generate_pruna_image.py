#!/usr/bin/env python3
"""
Generate images using Pruna AI's P-API.
Usage:
  python3 scripts/generate_pruna_image.py "Your prompt here" web/public/logo.png
"""

import sys
import os
import time
import requests

def generate_image(prompt: str, output_path: str, model: str = "p-image-ideogram", aspect_ratio: str = "1:1"):
    api_key = os.getenv("PRUNA_API_KEY")
    if not api_key:
        print("Error: PRUNA_API_KEY environment variable is not set.", file=sys.stderr)
        print("Please export PRUNA_API_KEY='your_api_key' before running.", file=sys.stderr)
        sys.exit(1)

    url = "https://api.pruna.ai/v1/predictions"
    headers = {
        "Content-Type": "application/json",
        "apikey": api_key,
        "Model": model,
    }
    payload = {
        "input": {
            "prompt": prompt,
            "aspect_ratio": aspect_ratio,
        }
    }

    print(f"Sending generation request to Pruna ({model})...")
    res = requests.post(url, json=payload, headers=headers)
    if not res.ok:
        print(f"Request failed ({res.status_code}): {res.text}", file=sys.stderr)
        sys.exit(1)

    data = res.json()
    print("Response from Pruna:", data)

    # If the response directly has the output URL:
    image_url = None
    if isinstance(data, dict):
        if "output" in data and data["output"]:
            image_url = data["output"] if isinstance(data["output"], str) else data["output"][0]
        elif "urls" in data and "get" in data["urls"]:
            # Async polling
            poll_url = data["urls"]["get"]
            print(f"Polling generation status at {poll_url}...")
            for _ in range(60):
                time.sleep(2)
                p_res = requests.get(poll_url, headers=headers)
                if p_res.ok:
                    p_data = p_res.json()
                    status = p_data.get("status")
                    if status == "succeeded":
                        image_url = p_data.get("output")
                        if isinstance(image_url, list):
                            image_url = image_url[0]
                        break
                    elif status == "failed":
                        print(f"Generation failed: {p_data}", file=sys.stderr)
                        sys.exit(1)

    if not image_url:
        print(f"Could not retrieve image URL from response: {data}", file=sys.stderr)
        sys.exit(1)

    print(f"Downloading image from {image_url}...")
    img_data = requests.get(image_url).content
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(img_data)
    print(f"Saved generated image to {output_path}")

if __name__ == "__main__":
    prompt_text = sys.argv[1] if len(sys.argv) > 1 else "Modern minimalist emblem logo for 'The Trappists' hackathon team, monastic chalice fused with glowing optical fiber network graph nodes, gold and obsidian dark tones, vector badge style"
    out = sys.argv[2] if len(sys.argv) > 2 else "web/public/trappists-logo.png"
    generate_image(prompt_text, out)

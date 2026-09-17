"""Titelbilder per SDXS-512 (1-Schritt-Diffusion, CPU).

Läuft als eigener Kurzzeit-Prozess (`python -m app.images '<json>'`), gestartet von main.py:
Das Modell (~3,7 GB RAM) belegt nur während der Generierung Speicher, und ein OOM-Kill trifft
nicht den Webserver.
"""
import json
import os
import sys
from pathlib import Path

IMAGES = Path(__file__).resolve().parent.parent / "data" / "images"
MODEL = "IDKiro/sdxs-512-0.9"


def prompt_for(title: str, cuisine: str) -> str:
    return f"food photography of {title}, {cuisine + ' cuisine, ' if cuisine else ''}appetizing, on a plate, soft natural light"


def main(jobs: list[dict]):
    import torch
    from diffusers import StableDiffusionPipeline
    from huggingface_hub import snapshot_download

    torch.set_num_threads(int(os.environ.get("IMAGE_THREADS", "3")))
    # Erster Aufruf lädt ~2,6 GB in HF_HOME; danach aus dem Cache. vae_large wird von der Pipeline nicht genutzt.
    # Erst lokal suchen, damit der Betrieb ohne Internet funktioniert.
    try:
        path = snapshot_download(MODEL, local_files_only=True)
    except Exception:
        path = snapshot_download(MODEL, allow_patterns=["*.json", "*.txt", "*.safetensors"], ignore_patterns=["vae_large/*"])
    pipe = StableDiffusionPipeline.from_pretrained(path, torch_dtype=torch.float32, use_safetensors=True, safety_checker=None)
    pipe.set_progress_bar_config(disable=True)
    IMAGES.mkdir(parents=True, exist_ok=True)
    for job in jobs:
        try:
            with torch.inference_mode():
                img = pipe(prompt_for(job["title"], job["cuisine"]), num_inference_steps=1, guidance_scale=0).images[0]
            tmp = IMAGES / f"{job['id']}.tmp.webp"
            img.resize((384, 384)).save(tmp, quality=80)
            tmp.replace(IMAGES / f"{job['id']}.webp")  # atomar: Frontend sieht nie halbe Dateien
        except Exception as e:  # ein kaputtes Bild soll die restlichen nicht verhindern
            print(f"Bild für Rezept {job['id']} fehlgeschlagen: {e}", file=sys.stderr)


if __name__ == "__main__":
    main(json.loads(sys.argv[1]))

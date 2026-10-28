#!/usr/bin/env python3
"""Generate a QR code for the public F-Droid repository enrollment URL."""
import argparse
from pathlib import Path

import qrcode

FINGERPRINT = "9AD6CBA4D5CEBA10557F1B816AFCEBCA0AA11540A1A3BE8421875D7DAB1505E2"
REPOSITORY_URL = "https://secret-camera.standen.link/fdroid/repo/"
ENROLLMENT_URL = f"https://secret-camera.standen.link/fdroid/repo/?fingerprint={FINGERPRINT}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=8, border=4)
    qr.add_data(ENROLLMENT_URL)
    qr.make(fit=True)
    qr.make_image(fill_color="black", back_color="white").save(args.output)


if __name__ == "__main__":
    main()

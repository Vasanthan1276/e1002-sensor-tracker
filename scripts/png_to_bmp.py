import sys
from pathlib import Path
from PIL import Image


EXPECTED_SIZE = (800, 480)


def main():
    if len(sys.argv) != 3:
        print("Usage: python png_to_bmp.py <input.png> <output.bmp>")
        sys.exit(1)

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])

    image = Image.open(input_path)

    if image.size != EXPECTED_SIZE:
        raise RuntimeError(
            f"Unexpected image size {image.size}; expected {EXPECTED_SIZE}"
        )

    if "A" in image.getbands():
        background = Image.new("RGB", image.size, (255, 255, 255))
        background.paste(image, mask=image.getchannel("A"))
        image = background
    else:
        image = image.convert("RGB")

    image.save(output_path, format="BMP")

    check = Image.open(output_path)

    if check.size != EXPECTED_SIZE:
        raise RuntimeError(
            f"Generated BMP size {check.size}; expected {EXPECTED_SIZE}"
        )

    print(
        f"Saved {output_path} as "
        f"{check.size[0]}x{check.size[1]} BMP"
    )


if __name__ == "__main__":
    main()

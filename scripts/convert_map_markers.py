from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT = Path('assets/map-markers')
OUT.mkdir(parents=True, exist_ok=True)
SIZE = (96, 112)


def marker(name, color, accent, symbol):
    shadow = Image.new('RGBA', SIZE, (0, 0, 0, 0))
    s = ImageDraw.Draw(shadow)
    s.ellipse((18, 80, 78, 102), fill=(0, 0, 0, 70))
    shadow = shadow.filter(ImageFilter.GaussianBlur(5))

    image = Image.new('RGBA', SIZE, (0, 0, 0, 0))
    image.alpha_composite(shadow)
    draw = ImageDraw.Draw(image)
    pin = [(48, 4), (18, 30), (20, 60), (48, 105), (76, 60), (78, 30)]
    draw.polygon(pin, fill=color)
    draw.ellipse((17, 5, 79, 67), fill=color)
    draw.ellipse((24, 12, 72, 60), fill=(255, 255, 255, 248))

    if symbol == 'drop':
        draw.polygon([(48, 22), (36, 43), (40, 52), (48, 56), (56, 52), (60, 43)], fill=accent)
        draw.arc((39, 36, 58, 52), 25, 135, fill=(255, 255, 255, 220), width=3)
    elif symbol == 'wave':
        for offset, wave_color in ((0, accent), (-9, (92, 218, 211, 255))):
            points = []
            for x in range(31, 66):
                y = 43 + offset + int(4 * __import__('math').sin((x - 31) * 0.35))
                points.append((x, y))
            draw.line(points, fill=wave_color, width=4, joint='curve')
    elif symbol == 'leaf':
        draw.ellipse((37, 23, 52, 50), fill=accent)
        draw.ellipse((44, 27, 59, 54), fill=(145, 222, 100, 255))
        draw.line((48, 53, 48, 30), fill=(44, 122, 24, 255), width=3)
    else:
        draw.ellipse((41, 29, 55, 43), fill=accent)

    image.save(OUT / f'{name}.png')

marker('reservoir', (22, 119, 255, 255), (22, 119, 255, 255), 'drop')
marker('river', (19, 194, 194, 255), (19, 194, 194, 255), 'wave')
marker('soil', (82, 196, 26, 255), (82, 196, 26, 255), 'leaf')
marker('default', (64, 150, 255, 255), (64, 150, 255, 255), 'default')

for item in OUT.glob('*.png'):
    print(item)

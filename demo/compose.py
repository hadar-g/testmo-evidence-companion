#!/usr/bin/env python3
"""Assembles the frames from demo/record.mjs into the media in docs/media; see demo/README.md."""
import json
import os
import shutil
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1280, 800
TABS_H, TOOLBAR_H = 38, 40
CHROME_H = TABS_H + TOOLBAR_H
PANEL_HEAD_H = 36
PANEL_TITLE = 'Testmo Evidence Companion'
HERE = os.path.dirname(os.path.abspath(__file__))
ICON = Image.open(os.path.join(HERE, '..', 'icons', 'icon128.png')).convert('RGBA')


def font(size, weight='regular'):
    candidates = {
        'regular': ['/System/Library/Fonts/SFNS.ttf', '/System/Library/Fonts/Helvetica.ttc', '/Library/Fonts/Arial Unicode.ttf'],
        'bold': ['/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/SFNS.ttf'],
    }[weight]
    for c in candidates:
        if os.path.exists(c):
            try:
                f = ImageFont.truetype(c, size)
                if weight == 'bold' and c.endswith('Helvetica.ttc'):
                    f = ImageFont.truetype(c, size, index=1)
                return f
            except Exception:
                continue
    return ImageFont.load_default()


F13, F14, F15B, F20, F22B = font(13), font(14), font(15, 'bold'), font(20), font(22, 'bold')


def rounded(draw, xy, r, fill, outline=None, width=1):
    draw.rounded_rectangle(xy, radius=r, fill=fill, outline=outline, width=width)


def browser_frame(url):
    img = Image.new('RGBA', (W, H), (222, 225, 230, 255))
    d = ImageDraw.Draw(img)
    # tab strip
    d.rectangle((0, 0, W, TABS_H), fill=(222, 225, 230))
    for i, c in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
        d.ellipse((14 + i * 20, 12, 26 + i * 20, 24), fill=c)
    rounded(d, (86, 6, 330, TABS_H + 2), 9, fill=(255, 255, 255))
    d.ellipse((100, 14, 114, 28), fill=(15, 118, 110))
    d.text((122, 12), 'Summit Outfitters', font=F13, fill=(40, 44, 52))
    d.text((312, 8), '×', font=F14, fill=(120, 124, 130))
    d.text((346, 6), '+', font=font(18), fill=(90, 94, 100))
    # toolbar: back / forward / reload drawn as strokes
    d.rectangle((0, TABS_H, W, CHROME_H), fill=(255, 255, 255))
    g = (95, 99, 104)
    cy = TABS_H + TOOLBAR_H // 2
    d.line((20, cy, 34, cy), fill=g, width=2); d.line((20, cy, 26, cy - 6), fill=g, width=2); d.line((20, cy, 26, cy + 6), fill=g, width=2)
    d.line((52, cy, 66, cy), fill=g, width=2); d.line((66, cy, 60, cy - 6), fill=g, width=2); d.line((66, cy, 60, cy + 6), fill=g, width=2)
    d.arc((84, cy - 7, 98, cy + 7), start=30, end=330, fill=g, width=2); d.polygon([(97, cy - 9), (101, cy - 2), (94, cy - 3)], fill=g)
    rounded(d, (120, TABS_H + 6, W - 150, CHROME_H - 6), 14, fill=(241, 243, 244))
    # padlock
    rounded(d, (138, cy - 1, 148, cy + 6), 2, fill=g); d.arc((139, cy - 8, 147, cy + 1), start=180, end=360, fill=g, width=2)
    host = url.replace('https://', '').replace('http://', '')
    path = ''
    if '/' in host:
        host, path = host.split('/', 1)
        path = '/' + path
    d.text((160, TABS_H + 11), host, font=F14, fill=(32, 33, 36))
    hw = d.textlength(host, font=F14)
    d.text((160 + hw, TABS_H + 11), path, font=F14, fill=(120, 124, 130))
    icon = ICON.resize((22, 22), Image.LANCZOS)
    img.alpha_composite(icon, (W - 128, cy - 11))
    # side panel toggle + menu dots
    d.rounded_rectangle((W - 96, cy - 8, W - 76, cy + 8), radius=3, outline=g, width=2); d.line((W - 83, cy - 8, W - 83, cy + 8), fill=g, width=2)
    for k in range(3):
        d.ellipse((W - 58, cy - 7 + k * 6, W - 55, cy - 4 + k * 6), fill=g)
    return img


def cursor_layer(img, cur, click, layout):
    if not cur:
        return
    page = cur['page']
    ox, oy = layout.get(page, (None, None))
    if ox is None:
        return
    x, y = ox + cur['x'], oy + cur['y']
    d = ImageDraw.Draw(img)
    if click:
        ring = Image.new('RGBA', img.size, (0, 0, 0, 0))
        rd = ImageDraw.Draw(ring)
        rd.ellipse((x - 16, y - 16, x + 16, y + 16), fill=(37, 99, 235, 70), outline=(37, 99, 235, 160), width=2)
        img.alpha_composite(ring)
    pts = [(x, y), (x, y + 17), (x + 4, y + 13), (x + 7, y + 19), (x + 10, y + 18), (x + 7, y + 12), (x + 12, y + 12)]
    d.polygon(pts, fill=(255, 255, 255), outline=(20, 20, 20))


def caption_layer(img, text):
    if not text:
        return
    d = ImageDraw.Draw(img)
    pad = 14
    tw = d.textlength(text, font=F20)
    bw, bh = tw + pad * 2, 44
    x0, y0 = 24, H - 24 - bh
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.rounded_rectangle((x0, y0, x0 + bw, y0 + bh), radius=12, fill=(17, 24, 39, 215))
    img.alpha_composite(layer)
    d.text((x0 + pad, y0 + 10), text, font=F20, fill=(255, 255, 255))


def compose(frames_dir, rec, kind, cfg, with_caption=True):
    ext = 'png' if kind == 'snaps' else 'jpg'
    app = Image.open(os.path.join(frames_dir, kind, f"{rec['id']}-app.{ext}")).convert('RGBA')
    panel = Image.open(os.path.join(frames_dir, kind, f"{rec['id']}-panel.{ext}")).convert('RGBA')
    img = browser_frame(rec['url'])
    aw, ah = cfg['app']['w'], cfg['app']['h']
    pw, ph = cfg['panel']['w'], cfg['panel']['h']
    img.alpha_composite(app.resize((aw, ah)) if app.size != (aw, ah) else app, (0, CHROME_H))
    px = W - pw
    d = ImageDraw.Draw(img)
    d.rectangle((px, CHROME_H, W, H), fill=(255, 255, 255))
    d.line((px, CHROME_H, px, H), fill=(218, 220, 224), width=1)
    d.line((px, CHROME_H + PANEL_HEAD_H - 1, W, CHROME_H + PANEL_HEAD_H - 1), fill=(232, 234, 237), width=1)
    img.alpha_composite(ICON.resize((18, 18), Image.LANCZOS), (px + 14, CHROME_H + 9))
    d.text((px + 40, CHROME_H + 9), PANEL_TITLE, font=F14, fill=(32, 33, 36))
    d.text((W - 28, CHROME_H + 7), '×', font=font(16), fill=(95, 99, 104))
    img.alpha_composite(panel.resize((pw, ph)) if panel.size != (pw, ph) else panel, (px + 1, CHROME_H + PANEL_HEAD_H))
    layout = {'app': (0, CHROME_H), 'panel': (px + 1, CHROME_H + PANEL_HEAD_H)}
    if rec.get('overlay'):
        opath = os.path.join(frames_dir, kind, f"{rec['id']}-overlay.{ext}")
        if os.path.exists(opath):
            ov = Image.open(opath).convert('RGBA')
            ow, oh = cfg['overlay']['w'], cfg['overlay']['h']
            title_h = 32
            wx, wy = (W - ow) // 2, 70
            scrim = Image.new('RGBA', img.size, (15, 23, 42, 90))
            img.alpha_composite(scrim)
            shadow = Image.new('RGBA', img.size, (0, 0, 0, 0))
            ImageDraw.Draw(shadow).rounded_rectangle((wx - 6, wy - 2, wx + ow + 6, wy + oh + title_h + 12), radius=14, fill=(0, 0, 0, 120))
            img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(14)))
            d = ImageDraw.Draw(img)
            rounded(d, (wx, wy, wx + ow, wy + oh + title_h), 10, fill=(236, 238, 241))
            for i, c in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
                d.ellipse((wx + 12 + i * 20, wy + 10, wx + 24 + i * 20, wy + 22), fill=c)
            title = 'Annotate screenshot' if rec['overlay'] == 'annotate' else 'Recording'
            d.text((wx + ow / 2 - d.textlength(title, font=F14) / 2, wy + 8), title, font=F14, fill=(60, 64, 70))
            img.alpha_composite(ov.resize((ow, oh)) if ov.size != (ow, oh) else ov, (wx, wy + title_h))
            layout['overlay'] = (wx, wy + title_h)
    cursor_layer(img, rec.get('cursor'), rec.get('click'), layout)
    if with_caption:
        caption_layer(img, rec.get('caption', ''))
    return img.convert('RGB')


def ffmpeg(*args):
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *args], check=True)


def write_video(frames, frame_dir, out_base, gif=True, gif_width=960):
    if len(frames) < 2:
        return
    lst = out_base + '.txt'
    with open(lst, 'w') as f:
        for i, fr in enumerate(frames):
            dur = (frames[i + 1]['t'] - fr['t']) / 1000 if i + 1 < len(frames) else 1.5
            dur = min(max(dur, 0.04), 3.0)
            f.write(f"file '{os.path.join(frame_dir, fr['id'] + '.png')}'\nduration {dur:.3f}\n")
        f.write(f"file '{os.path.join(frame_dir, frames[-1]['id'] + '.png')}'\n")
    ffmpeg('-f', 'concat', '-safe', '0', '-i', lst, '-vf', 'fps=15,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', out_base + '.mp4')
    if gif:
        ffmpeg('-f', 'concat', '-safe', '0', '-i', lst, '-vf', f'fps=10,scale={gif_width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', '-loop', '0', out_base + '.gif')
    os.remove(lst)


def tiles(out_dir, hero_src):
    """Chrome Web Store artwork: 440x280 small tile, 1400x560 marquee, 1280x800 hero."""
    def gradient(w, h):
        base = Image.new('RGB', (w, h), (15, 23, 42))
        top = Image.new('RGB', (w, h), (30, 64, 175))
        mask = Image.linear_gradient('L').rotate(-25, expand=True).resize((w, h))
        return Image.composite(top, base, mask).convert('RGBA')

    def branding(img, x, y, icon_size, title_font, sub_font, sub):
        img.alpha_composite(ICON.resize((icon_size, icon_size), Image.LANCZOS), (x, y))
        d = ImageDraw.Draw(img)
        d.text((x + icon_size + 18, y + icon_size * 0.05), PANEL_TITLE, font=title_font, fill=(255, 255, 255))
        d.text((x + icon_size + 18, y + icon_size * 0.55), sub, font=sub_font, fill=(191, 219, 254))

    hero = Image.open(hero_src).convert('RGBA')
    # small tile 440x280
    t = gradient(440, 280)
    branding(t, 24, 26, 52, font(21, 'bold'), font(14), 'Test evidence, without the tab switching')
    shot = hero.resize((int(hero.width * 0.36), int(hero.height * 0.36)), Image.LANCZOS)
    t.alpha_composite(shot, (60, 130))
    t.convert('RGB').save(os.path.join(out_dir, 'store-small-tile-440x280.png'))
    # marquee 1400x560
    m = gradient(1400, 560)
    branding(m, 70, 70, 84, font(36, 'bold'), font(21), 'Run Testmo tests from Chrome’s side panel.\nCapture, annotate, record, submit.')
    d = ImageDraw.Draw(m)
    for i, line in enumerate(['✓ Read steps beside the page under test', '✓ Screenshot + annotate in one click', '✓ Record steps as video and text', '✓ Your API key never leaves your device']):
        d.text((70, 300 + i * 40), line, font=font(22), fill=(226, 232, 240))
    shot = hero.resize((672, 420), Image.LANCZOS)
    shadow = Image.new('RGBA', m.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((690, 90, 690 + 672, 90 + 420), radius=12, fill=(0, 0, 0, 140))
    m.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(18)))
    mask = Image.new('L', shot.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, shot.width, shot.height), radius=12, fill=255)
    m.paste(shot, (690, 70), mask)
    m.convert('RGB').save(os.path.join(out_dir, 'store-marquee-1400x560.png'))
    # README hero 1280x640 banner
    b = gradient(1280, 640)
    branding(b, 60, 60, 84, font(40, 'bold'), font(22), 'Test evidence, without the tab switching')
    shot = hero.resize((880, 550), Image.LANCZOS)
    mask = Image.new('L', shot.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, shot.width, shot.height), radius=12, fill=255)
    shadow = Image.new('RGBA', b.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((360, 200, 360 + 880, 200 + 550), radius=12, fill=(0, 0, 0, 150))
    b.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(20)))
    b.paste(shot, (360, 190), mask)
    b.convert('RGB').save(os.path.join(out_dir, 'banner-1280x640.png'))


def main():
    frames_dir, out_dir = sys.argv[1], sys.argv[2]
    cfg = json.load(open(os.path.join(frames_dir, 'manifest.json')))
    os.makedirs(os.path.join(out_dir, 'screenshots'), exist_ok=True)
    os.makedirs(os.path.join(out_dir, 'video'), exist_ok=True)
    comp_dir = os.path.join(frames_dir, 'composite')
    shutil.rmtree(comp_dir, ignore_errors=True)
    os.makedirs(comp_dir)

    for i, fr in enumerate(cfg['frames']):
        compose(frames_dir, fr, 'frames', cfg).save(os.path.join(comp_dir, fr['id'] + '.png'), compress_level=1)
        if i % 100 == 0:
            print(f'  composited {i}/{len(cfg["frames"])}', flush=True)

    for sn in cfg['snaps']:
        compose(frames_dir, sn, 'snaps', cfg, with_caption=False).save(os.path.join(out_dir, 'screenshots', sn['id'] + '.png'))
        compose(frames_dir, sn, 'snaps', cfg, with_caption=True).save(os.path.join(out_dir, 'screenshots', sn['id'] + '-captioned.png'))

    frames = cfg['frames']
    write_video(frames, comp_dir, os.path.join(out_dir, 'video', 'full-demo'), gif=False)
    scenes = {}
    for fr in frames:
        scenes.setdefault(fr['scene'], []).append(fr)
    groups = {
        'connect-and-browse': ['connect', 'runs', 'run', 'test'],
        'capture-annotate-submit': ['capture'],
        'record-steps': ['record'],
        'add-test-case': ['addcase'],
    }
    for name, keys in groups.items():
        sel = [fr for k in keys for fr in scenes.get(k, [])]
        write_video(sel, comp_dir, os.path.join(out_dir, 'video', name))

    hero_name = next((s['id'] for s in cfg['snaps'] if s['id'] == '06-test-evidence'), cfg['snaps'][0]['id'])
    tiles(out_dir, os.path.join(out_dir, 'screenshots', hero_name + '.png'))
    print('done →', out_dir)


if __name__ == '__main__':
    main()

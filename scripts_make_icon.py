"""One-off design script (not part of the build) to generate the Compile Daily
launcher icon. Run once with Pillow installed; output is checked into
assets/icon/ic_launcher.png and consumed directly (as raw bytes) by
build_apk.py, which has no image-library dependency itself."""
from PIL import Image, ImageDraw, ImageOps, ImageFilter

SIZE = 192
S = SIZE

# Brand blue gradient (matches the app's --brand / --brand2 iOS palette), diagonal.
top_color = (61, 126, 255)      # lighter blue
bottom_color = (10, 60, 200)    # deeper blue

grad = Image.linear_gradient('L').resize((S, S), Image.BICUBIC)
bg = ImageOps.colorize(grad, black=bottom_color, white=top_color).convert('RGBA')

# Squircle mask (rounded square, iOS-style corner radius ~22%).
mask = Image.new('L', (S, S), 0)
mdraw = ImageDraw.Draw(mask)
radius = int(S * 0.225)
mdraw.rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=255)

icon = Image.new('RGBA', (S, S), (0, 0, 0, 0))
icon.paste(bg, (0, 0), mask)
draw = ImageDraw.Draw(icon)

# Subtle inner top highlight for depth.
highlight = Image.new('L', (S, S), 0)
hdraw = ImageDraw.Draw(highlight)
hdraw.ellipse([S * 0.05, -S * 0.35, S * 1.05, S * 0.55], fill=60)
highlight = highlight.filter(ImageFilter.GaussianBlur(S * 0.08))
white_layer = Image.new('RGBA', (S, S), (255, 255, 255, 255))
icon = Image.composite(Image.alpha_composite(icon, Image.new('RGBA', (S, S), (0, 0, 0, 0))), icon, mask)
icon.paste(white_layer, (0, 0), Image.composite(highlight, Image.new('L', (S, S), 0), mask))

draw = ImageDraw.Draw(icon)

# --- Glyph: a code prompt "> _" (compile / terminal) drawn as pure vector shapes,
# so it renders identically with no font dependency. ---
white = (255, 255, 255, 255)
cx, cy = S * 0.5, S * 0.46
stroke = S * 0.075

# ">" chevron: two thick diagonal segments meeting at a point.
p_top = (cx - S * 0.16, cy - S * 0.16)
p_mid = (cx + S * 0.10, cy)
p_bot = (cx - S * 0.16, cy + S * 0.16)
draw.line([p_top, p_mid], fill=white, width=int(stroke), joint='curve')
draw.line([p_mid, p_bot], fill=white, width=int(stroke), joint='curve')
for p in (p_top, p_mid, p_bot):
    r = stroke / 2
    draw.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=white)

# "_" underscore (the cursor).
u_y = cy + S * 0.225
u_x1, u_x2 = cx + S * 0.02, cx + S * 0.26
draw.line([(u_x1, u_y), (u_x2, u_y)], fill=white, width=int(stroke), joint='curve')
for p in ((u_x1, u_y), (u_x2, u_y)):
    r = stroke / 2
    draw.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=white)

# --- "Daily streak" badge: small green circle with a checkmark, bottom-right. ---
badge_r = S * 0.155
badge_cx, badge_cy = S * 0.775, S * 0.79
badge_ring = S * 0.02
draw.ellipse([badge_cx - badge_r - badge_ring, badge_cy - badge_r - badge_ring,
              badge_cx + badge_r + badge_ring, badge_cy + badge_r + badge_ring], fill=(20, 40, 110, 255))
draw.ellipse([badge_cx - badge_r, badge_cy - badge_r, badge_cx + badge_r, badge_cy + badge_r], fill=(52, 199, 89, 255))
check_w = S * 0.035
c1 = (badge_cx - badge_r * 0.5, badge_cy)
c2 = (badge_cx - badge_r * 0.12, badge_cy + badge_r * 0.4)
c3 = (badge_cx + badge_r * 0.55, badge_cy - badge_r * 0.42)
draw.line([c1, c2], fill=white, width=int(check_w), joint='curve')
draw.line([c2, c3], fill=white, width=int(check_w), joint='curve')
for p in (c1, c2, c3):
    r = check_w / 2
    draw.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=white)

out_path = "C:/Users/MrigankarSonowal/Downloads/JavaCareerPrep-Source/assets/icon/ic_launcher.png"
icon.save(out_path)
print("saved", out_path, icon.size)

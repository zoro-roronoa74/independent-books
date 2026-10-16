import math
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

def create_social_preview():
    W, H = 1280, 640
    img = Image.new('RGBA', (W, H), (255, 255, 255, 255))
    draw = ImageDraw.Draw(img)

    # 1. Subtle Radial / Linear Background Gradient (Light mint to pristine white)
    for y in range(H):
        # Soft blend from light mint #F3FAF6 at top to #FFFFFF at bottom
        r = int(243 + (255 - 243) * (y / H))
        g = int(250 + (255 - 250) * (y / H))
        b = int(246 + (255 - 246) * (y / H))
        draw.line([(0, y), (W, y)], fill=(r, g, b, 255))

    # Ambient soft emerald glow in the top-left and top-right
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse([(-100, -100), (500, 500)], fill=(16, 185, 129, 20))
    glow_draw.ellipse([(800, -100), (1400, 500)], fill=(16, 185, 129, 16))
    glow = glow.filter(ImageFilter.GaussianBlur(60))
    img = Image.alpha_composite(img, glow)
    draw = ImageDraw.Draw(img)

    # 2. Delicate Double-Entry Ledger Grid Pattern
    grid_color = (16, 185, 129, 14)
    grid_img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    grid_draw = ImageDraw.Draw(grid_img)
    step = 36
    for x in range(0, W, step):
        grid_draw.line([(x, 0), (x, H)], fill=grid_color, width=1)
    for y in range(0, H, step):
        grid_draw.line([(0, y), (W, y)], fill=grid_color, width=1)
    img = Image.alpha_composite(img, grid_img)
    draw = ImageDraw.Draw(img)

    # Fonts
    font_bold = "C:/Windows/Fonts/segoeuib.ttf"
    font_reg = "C:/Windows/Fonts/segoeui.ttf"
    font_mono = "C:/Windows/Fonts/consola.ttf"

    f_title = ImageFont.truetype(font_bold, 42)
    f_brand = ImageFont.truetype(font_bold, 28)
    f_sub = ImageFont.truetype(font_reg, 18)
    f_badge = ImageFont.truetype(font_bold, 13)
    f_body = ImageFont.truetype(font_reg, 16)
    f_code = ImageFont.truetype(font_mono, 13)
    f_kpi_val = ImageFont.truetype(font_bold, 20)
    f_kpi_lbl = ImageFont.truetype(font_bold, 11)

    # 3. Left Side: Brand & Hero Messaging
    # Badge Pill: "✨ 100% FREE & AIR-GAPPED · MIT LICENSE"
    bx, by = 60, 52
    badge_text = "✨ 100% FREE & AIR-GAPPED · MIT LICENSE"
    bbox = f_badge.getbbox(badge_text)
    bw = bbox[2] - bbox[0] + 28
    bh = 28
    draw.rounded_rectangle([bx, by, bx + bw, by + bh], radius=14, fill=(230, 249, 238, 255), outline=(167, 243, 208, 255), width=1)
    draw.text((bx + 14, by + 5), badge_text, font=f_badge, fill=(4, 120, 87, 255))

    # Logo + Brand
    logo_path = 'docs/assets/logo.png'
    ly = by + 46
    if os.path.exists(logo_path):
        logo_raw = Image.open(logo_path).convert('RGBA')
        logo_size = 54
        logo_resized = logo_raw.resize((logo_size, logo_size), Image.Resampling.LANCZOS)
        img.paste(logo_resized, (bx, ly), logo_resized)
        draw = ImageDraw.Draw(img)
        # Text next to logo
        draw.text((bx + 66, ly + 4), "Independent ", font=f_brand, fill=(78, 110, 97, 255))
        ibbox = f_brand.getbbox("Independent ")
        draw.text((bx + 66 + ibbox[2] - ibbox[0], ly + 4), "BOOKS", font=f_brand, fill=(4, 120, 87, 255))
    else:
        draw.text((bx, ly + 4), "Independent BOOKS", font=f_brand, fill=(4, 120, 87, 255))

    # Headline
    hy = ly + 72
    draw.text((bx, hy), "Accounting Software", font=f_title, fill=(7, 42, 30, 255))
    draw.text((bx, hy + 50), "You Own. Not Rent.", font=f_title, fill=(5, 150, 105, 255))

    # Subtitle
    sy = hy + 116
    draw.text((bx, sy), "The open-source, air-gapped Tally Prime alternative.", font=f_sub, fill=(78, 110, 97, 255))
    draw.text((bx, sy + 28), "Full keyboard muscle memory, two-sided balance sheet,", font=f_sub, fill=(78, 110, 97, 255))
    draw.text((bx, sy + 56), "and local SQLite data that never touches the cloud.", font=f_sub, fill=(78, 110, 97, 255))

    # Bullet checkmarks
    bullet_y = sy + 104
    bullets = [
        ("✓", "Full Tally Hotkeys (F2–F10, Alt+G, Ctrl+A)", (4, 120, 87)),
        ("✓", "Exact Python Decimal Math (Zero Plugs)", (4, 120, 87)),
        ("✓", "Windows C Native (8.57 MB) · macOS · Android", (4, 120, 87))
    ]
    for icon, text, col in bullets:
        draw.text((bx, bullet_y), icon, font=f_badge, fill=(16, 185, 129, 255))
        draw.text((bx + 20, bullet_y - 2), text, font=f_body, fill=(25, 56, 43, 255))
        bullet_y += 32

    # 4. Right Side: Workstation Application Frame Mockup
    fx, fy, fw, fh = 570, 48, 650, 544

    # Drop Shadow for Workstation Frame
    shadow_img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    s_draw = ImageDraw.Draw(shadow_img)
    s_draw.rounded_rectangle([fx + 4, fy + 8, fx + fw + 4, fy + fh + 8], radius=16, fill=(7, 42, 30, 35))
    shadow_img = shadow_img.filter(ImageFilter.GaussianBlur(18))
    img = Image.alpha_composite(img, shadow_img)
    draw = ImageDraw.Draw(img)

    # Frame Container
    draw.rounded_rectangle([fx, fy, fx + fw, fy + fh], radius=16, fill=(255, 255, 255, 255), outline=(167, 243, 208, 255), width=2)

    # Titlebar
    tb_h = 44
    draw.rounded_rectangle([fx, fy, fx + fw, fy + tb_h], radius=16, fill=(240, 253, 244, 255))
    draw.rectangle([fx, fy + tb_h - 10, fx + fw, fy + tb_h], fill=(240, 253, 244, 255))
    draw.line([(fx, fy + tb_h), (fx + fw, fy + tb_h)], fill=(227, 239, 231, 255), width=1)

    # Traffic dots
    dot_y = fy + 17
    draw.ellipse([fx + 18, dot_y, fx + 28, dot_y + 10], fill=(248, 113, 113, 255))
    draw.ellipse([fx + 34, dot_y, fx + 44, dot_y + 10], fill=(251, 191, 36, 255))
    draw.ellipse([fx + 50, dot_y, fx + 60, dot_y + 10], fill=(52, 211, 153, 255))

    # Address bar pill
    addr_text = "● 127.0.0.1:3543 (Air-Gapped Localhost)"
    abbox = f_code.getbbox(addr_text)
    aw = abbox[2] - abbox[0] + 20
    draw.rounded_rectangle([fx + 76, fy + 9, fx + 76 + aw, fy + 33], radius=12, fill=(255, 255, 255, 255), outline=(167, 243, 208, 255), width=1)
    draw.text((fx + 86, fy + 13), addr_text, font=f_code, fill=(4, 120, 87, 255))

    # Seal stamp on right of titlebar
    seal_text = "✓ BALANCED"
    sb_bbox = f_badge.getbbox(seal_text)
    sw = sb_bbox[2] - sb_bbox[0] + 16
    draw.rounded_rectangle([fx + fw - sw - 16, fy + 9, fx + fw - 16, fy + 33], radius=12, fill=(220, 252, 231, 255), outline=(134, 239, 172, 255), width=1)
    draw.text((fx + fw - sw - 8, fy + 14), seal_text, font=f_badge, fill=(22, 101, 52, 255))

    # Tabs inside Workstation
    tab_y = fy + tb_h + 1
    tab_h = 36
    tabs = ["Gateway (G)", "F8 Sales Voucher", "Balance Sheet (B)", "Profit & Loss (P)"]
    tx = fx + 14
    for i, t in enumerate(tabs):
        is_active = (i == 0)
        t_box = f_kpi_lbl.getbbox(t)
        t_w = t_box[2] - t_box[0] + 24
        if is_active:
            draw.rounded_rectangle([tx, tab_y + 5, tx + t_w, tab_y + tab_h - 2], radius=6, fill=(240, 253, 244, 255), outline=(167, 243, 208, 255), width=1)
            draw.text((tx + 12, tab_y + 11), t, font=f_kpi_lbl, fill=(4, 120, 87, 255))
        else:
            draw.text((tx + 12, tab_y + 11), t, font=f_kpi_lbl, fill=(120, 145, 134, 255))
        tx += t_w + 6

    draw.line([(fx, tab_y + tab_h), (fx + fw, tab_y + tab_h)], fill=(227, 239, 231, 255), width=1)

    # Workstation Body: KPI Cards
    body_y = tab_y + tab_h + 16
    kpi_w = (fw - 48) // 3
    kpis = [
        ("TODAY'S SALES", "₹86,200.00", (5, 150, 105)),
        ("DUE FROM DEBTORS", "₹1,24,500.00", (2, 132, 199)),
        ("THIS MONTH'S PROFIT", "₹42,750.00", (217, 119, 6))
    ]
    for idx, (lbl, val, col) in enumerate(kpis):
        kx = fx + 16 + idx * (kpi_w + 8)
        draw.rounded_rectangle([kx, body_y, kx + kpi_w, body_y + 64], radius=8, fill=(240, 253, 244, 255), outline=(167, 243, 208, 255), width=1)
        draw.text((kx + 12, body_y + 10), lbl, font=f_kpi_lbl, fill=(100, 125, 114, 255))
        draw.text((kx + 12, body_y + 28), val, font=f_kpi_val, fill=col)

    # Interactive Vector Sales Trend SVG style preview
    chart_y = body_y + 80
    chart_h = 130
    draw.rounded_rectangle([fx + 16, chart_y, fx + fw - 16, chart_y + chart_h], radius=10, fill=(244, 251, 246, 255), outline=(205, 233, 216, 255), width=1)
    draw.text((fx + 28, chart_y + 12), "WEEKLY SALES TREND", font=f_kpi_lbl, fill=(78, 110, 97, 255))
    draw.text((fx + fw - 130, chart_y + 12), "+18.4% vs last week", font=f_kpi_lbl, fill=(5, 150, 105, 255))

    # Draw smooth vector curve with green fill
    points = [
        (fx + 28, chart_y + 110),
        (fx + 140, chart_y + 90),
        (fx + 260, chart_y + 70),
        (fx + 380, chart_y + 80),
        (fx + 500, chart_y + 40),
        (fx + fw - 28, chart_y + 25)
    ]
    # Poly fill
    poly_points = points.copy()
    poly_points.append((fx + fw - 28, chart_y + chart_h - 1))
    poly_points.append((fx + 28, chart_y + chart_h - 1))
    chart_fill = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    cf_draw = ImageDraw.Draw(chart_fill)
    cf_draw.polygon(poly_points, fill=(16, 185, 129, 35))
    img = Image.alpha_composite(img, chart_fill)
    draw = ImageDraw.Draw(img)

    for i in range(len(points) - 1):
        draw.line([points[i], points[i+1]], fill=(5, 150, 105, 255), width=3)
    for p in points:
        draw.ellipse([p[0] - 4, p[1] - 4, p[0] + 4, p[1] + 4], fill=(255, 255, 255, 255), outline=(5, 150, 105, 255), width=2)

    # Lower Two-Sided Ledger Teaser
    lower_y = chart_y + chart_h + 16
    draw.rounded_rectangle([fx + 16, lower_y, fx + fw - 16, lower_y + 160], radius=10, fill=(255, 255, 255, 255), outline=(205, 233, 216, 255), width=1)
    
    # Left: Two-Sided Balance Sheet summary
    half_w = (fw - 32) // 2
    draw.text((fx + 28, lower_y + 12), "TWO-SIDED BALANCE SHEET", font=f_kpi_lbl, fill=(4, 120, 87, 255))
    draw.line([(fx + 28, lower_y + 28), (fx + 28 + half_w - 20, lower_y + 28)], fill=(227, 239, 231, 255), width=1)
    draw.text((fx + 28, lower_y + 36), "Capital & Liabilities:   ₹7,47,100.00", font=f_code, fill=(25, 56, 43, 255))
    draw.text((fx + 28, lower_y + 56), "Property & Assets:       ₹7,47,100.00", font=f_code, fill=(25, 56, 43, 255))
    draw.text((fx + 28, lower_y + 76), "Diff. in Opening:               ₹0.00", font=f_code, fill=(5, 150, 105, 255))

    # Vertical split line
    draw.line([(fx + 16 + half_w, lower_y + 10), (fx + 16 + half_w, lower_y + 150)], fill=(227, 239, 231, 255), width=1)

    # Right: F8 Sales GST Breakdown
    rx = fx + 28 + half_w
    draw.text((rx, lower_y + 12), "STATE-AWARE GST ENGINE", font=f_kpi_lbl, fill=(4, 120, 87, 255))
    draw.line([(rx, lower_y + 28), (fx + fw - 28, lower_y + 28)], fill=(227, 239, 231, 255), width=1)
    draw.text((rx, lower_y + 36), "Taxable Value (10 pcs): ₹50,000.00", font=f_code, fill=(25, 56, 43, 255))
    draw.text((rx, lower_y + 56), "CGST @ 9% + SGST @ 9%:  ₹9,000.00", font=f_code, fill=(5, 150, 105, 255))
    draw.text((rx, lower_y + 76), "Grand Invoice Total:    ₹59,000.00", font=f_code, fill=(7, 42, 30, 255))

    # Bottom Pill in Frame: Keyboard hotkey reminder
    draw.rounded_rectangle([fx + 28, lower_y + 110, fx + fw - 28, lower_y + 144], radius=6, fill=(240, 253, 244, 255))
    draw.text((fx + 40, lower_y + 120), "⚡ 120 WPM Touch-Typist Ergonomics: Press F8 (Sales), F9 (Purchase), Alt+G (Go To)", font=f_code, fill=(4, 120, 87, 255))

    # Outer border
    draw.rectangle([(0, 0), (W - 1, H - 1)], outline=(167, 243, 208, 180), width=1)

    # Convert to RGB (standard Open Graph format)
    final_img = img.convert('RGB')
    
    # Save locations
    out_paths = [
        'docs/assets/social-preview.png',
        'social-preview.png'
    ]
    desktop_dir = os.path.expanduser('~/Desktop')
    if os.path.exists(desktop_dir):
        out_paths.append(os.path.join(desktop_dir, 'IndependentBooks_GitHub_Social_Preview.png'))

    for p in out_paths:
        final_img.save(p, format='PNG', optimize=True)
        print(f"Saved: {p} ({os.path.getsize(p) / 1024:.1f} KB)")

if __name__ == '__main__':
    create_social_preview()

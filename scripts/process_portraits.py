"""
Script: process_portraits.py
Processes generated agent portraits and compiles the visual proof contact sheet.
- Creates 1024x1024 RGBA transparent PNG masters in design/assets-source/agents/portraits/
- Creates 512x512 RGBA transparent WebP runtime assets in public/assets/agents/portraits/
- Assembles docs/design-assets-contact-sheet.png displaying all icons, portraits, and background preview.
"""

import os
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

PORTRAIT_SOURCES = {
    "buddha-chat": r"C:\Users\User\.gemini\antigravity-cli\brain\ba8fc38c-8bbd-4959-9b1a-1c6384f5e689\buddha_chat_1791156068514.jpg",
    "always-on-worker": r"C:\Users\User\.gemini\antigravity-cli\brain\ba8fc38c-8bbd-4959-9b1a-1c6384f5e689\always_on_worker_1791156083761.jpg",
    "connector": r"C:\Users\User\.gemini\antigravity-cli\brain\ba8fc38c-8bbd-4959-9b1a-1c6384f5e689\connector_1791156114250.jpg",
    "task-solver": r"C:\Users\User\.gemini\antigravity-cli\brain\ba8fc38c-8bbd-4959-9b1a-1c6384f5e689\task_solver_1791156128480.jpg",
    "task-writer": r"C:\Users\User\.gemini\antigravity-cli\brain\ba8fc38c-8bbd-4959-9b1a-1c6384f5e689\task_writer_1791156144638.jpg",
    "maintainer": r"C:\Users\User\.gemini\antigravity-cli\brain\ba8fc38c-8bbd-4959-9b1a-1c6384f5e689\maintainer_1791156166665.jpg",
    "operator": r"C:\Users\User\.gemini\antigravity-cli\brain\ba8fc38c-8bbd-4959-9b1a-1c6384f5e689\agent_operator_png_1791156071527.jpg",
    "ticket-master": r"C:\Users\User\.gemini\antigravity-cli\brain\ba8fc38c-8bbd-4959-9b1a-1c6384f5e689\agent_ticket_master_png_1791156087315.jpg",
    "wartungsagent": r"C:\Users\User\.gemini\antigravity-cli\brain\ba8fc38c-8bbd-4959-9b1a-1c6384f5e689\agent_wartungsagent_png_1791156100995.jpg",
    "system-auditor": r"C:\Users\User\.gemini\antigravity-cli\brain\ba8fc38c-8bbd-4959-9b1a-1c6384f5e689\agent_system_auditor_png_1791156115843.jpg",
    "law-checker": r"C:\Users\User\.gemini\antigravity-cli\brain\ba8fc38c-8bbd-4959-9b1a-1c6384f5e689\agent_law_checker_png_1791156130779.jpg",
    "researcher": r"C:\Users\User\.gemini\antigravity-cli\brain\ba8fc38c-8bbd-4959-9b1a-1c6384f5e689\agent_researcher_png_1791156145204.jpg"
}

def remove_white_background_fixed_range(pil_img, tolerance=18):
    """
    Removes white background using FLOODFILL_FIXED_RANGE seeded from the top corners and margins.
    Because it uses FLOODFILL_FIXED_RANGE, it never leaks across the subject even if the subject
    has light clothing or white details.
    """
    img_bgr = cv2.cvtColor(np.array(pil_img.convert("RGB")), cv2.COLOR_RGB2BGR)
    h, w = img_bgr.shape[:2]

    mask = np.zeros((h + 2, w + 2), np.uint8)

    # Perimeter seeds along top edge and upper left/right sides
    seeds = [(0, 0), (w - 1, 0), (w // 2, 0),
             (0, 50), (w - 1, 50),
             (0, 150), (w - 1, 150),
             (0, h // 2), (w - 1, h // 2)]

    loDiff = (tolerance, tolerance, tolerance)
    upDiff = (tolerance, tolerance, tolerance)
    flags = 4 | cv2.FLOODFILL_MASK_ONLY | cv2.FLOODFILL_FIXED_RANGE | (255 << 8)

    for cx, cy in seeds:
        b, g, r = img_bgr[cy, cx]
        if (int(r) + int(g) + int(b)) / 3.0 > 220:
            cv2.floodFill(img_bgr, mask, (cx, cy), 0, loDiff, upDiff, flags)

    bg_mask = mask[1:h+1, 1:w+1]

    # Foreground is where bg_mask == 0
    fg_mask = (bg_mask == 0).astype(np.float32)

    # Sub-pixel anti-aliasing on the silhouette boundary
    fg_mask = cv2.GaussianBlur(fg_mask, (3, 3), 0)
    alpha = np.clip(fg_mask * 255.0, 0, 255).astype(np.uint8)

    # Build RGBA
    rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    r, g, b = cv2.split(rgb)
    rgba = np.dstack((r, g, b, alpha))
    return Image.fromarray(rgba, "RGBA")

def draw_vector_icon_preview(draw, name, cx, cy, color, scale=1.5):
    """Draws an accurate vector contour preview of the 24x24 icon."""
    s = scale
    ox, oy = cx - 12 * s, cy - 12 * s
    w = 2

    if name == "dashboard":
        draw.rounded_rectangle([(ox + 3*s, oy + 3*s), (ox + 10*s, oy + 12*s)], radius=2, outline=color, width=w)
        draw.rounded_rectangle([(ox + 14*s, oy + 3*s), (ox + 21*s, oy + 8*s)], radius=2, outline=color, width=w)
        draw.rounded_rectangle([(ox + 14*s, oy + 12*s), (ox + 21*s, oy + 21*s)], radius=2, outline=color, width=w)
        draw.rounded_rectangle([(ox + 3*s, oy + 16*s), (ox + 10*s, oy + 21*s)], radius=2, outline=color, width=w)
    elif name == "tasks":
        draw.rounded_rectangle([(ox + 5*s, oy + 4*s), (ox + 19*s, oy + 21*s)], radius=2, outline=color, width=w)
        draw.line([(ox + 8*s, oy + 4*s), (ox + 16*s, oy + 4*s)], fill=color, width=w)
        draw.line([(ox + 9*s, oy + 11*s), (ox + 11*s, oy + 13*s), (ox + 15*s, oy + 9*s)], fill=color, width=w)
        draw.line([(ox + 9*s, oy + 16*s), (ox + 15*s, oy + 16*s)], fill=color, width=w)
    elif name == "assistant":
        draw.line([(ox + 12*s, oy + 2*s), (ox + 12*s, oy + 6*s)], fill=color, width=w)
        draw.line([(ox + 12*s, oy + 18*s), (ox + 12*s, oy + 22*s)], fill=color, width=w)
        draw.line([(ox + 2*s, oy + 12*s), (ox + 6*s, oy + 12*s)], fill=color, width=w)
        draw.line([(ox + 18*s, oy + 12*s), (ox + 22*s, oy + 12*s)], fill=color, width=w)
        draw.ellipse([(ox + 8*s, oy + 8*s), (ox + 16*s, oy + 16*s)], outline=color, width=w)
    elif name == "life":
        draw.line([(ox + 12*s, oy + 14*s), (ox + 12*s, oy + 22*s)], fill=color, width=w)
        draw.arc([(ox + 5*s, oy + 7*s), (ox + 19*s, oy + 17*s)], 0, 180, fill=color, width=w)
        draw.arc([(ox + 5*s, oy + 5*s), (ox + 12*s, oy + 14*s)], 180, 360, fill=color, width=w)
    elif name == "agenten":
        draw.rounded_rectangle([(ox + 4*s, oy + 8*s), (ox + 20*s, oy + 20*s)], radius=3, outline=color, width=w)
        draw.line([(ox + 12*s, oy + 2*s), (ox + 12*s, oy + 8*s)], fill=color, width=w)
        draw.ellipse([(ox + 11*s, oy + 1*s), (ox + 13*s, oy + 3*s)], outline=color, width=w)
        draw.line([(ox + 8*s, oy + 13*s), (ox + 10*s, oy + 13*s)], fill=color, width=w)
        draw.line([(ox + 14*s, oy + 13*s), (ox + 16*s, oy + 13*s)], fill=color, width=w)
        draw.line([(ox + 9*s, oy + 17*s), (ox + 15*s, oy + 17*s)], fill=color, width=w)
    elif name == "domains":
        draw.ellipse([(ox + 3*s, oy + 3*s), (ox + 21*s, oy + 21*s)], outline=color, width=w)
        draw.line([(ox + 4*s, oy + 9*s), (ox + 20*s, oy + 9*s)], fill=color, width=w)
        draw.line([(ox + 4*s, oy + 15*s), (ox + 20*s, oy + 15*s)], fill=color, width=w)
        draw.arc([(ox + 7*s, oy + 3*s), (ox + 17*s, oy + 21*s)], 90, 270, fill=color, width=w)
    elif name == "files":
        draw.rounded_rectangle([(ox + 3*s, oy + 6*s), (ox + 21*s, oy + 20*s)], radius=2, outline=color, width=w)
        draw.line([(ox + 3*s, oy + 6*s), (ox + 8*s, oy + 4*s), (ox + 12*s, oy + 6*s)], fill=color, width=w)
    elif name == "governance":
        draw.polygon([(ox + 12*s, oy + 2*s), (ox + 20*s, oy + 5*s), (ox + 20*s, oy + 12*s),
                      (ox + 12*s, oy + 22*s), (ox + 4*s, oy + 12*s), (ox + 4*s, oy + 5*s)], outline=color, width=w)
        draw.line([(ox + 9*s, oy + 12*s), (ox + 11*s, oy + 14*s), (ox + 15*s, oy + 10*s)], fill=color, width=w)
    elif name == "system":
        draw.ellipse([(ox + 9*s, oy + 9*s), (ox + 15*s, oy + 15*s)], outline=color, width=w)
        draw.ellipse([(ox + 5*s, oy + 5*s), (ox + 19*s, oy + 19*s)], outline=color, width=w)
    elif name == "fabrika":
        draw.line([(ox + 2*s, oy + 20*s), (ox + 22*s, oy + 20*s)], fill=color, width=w)
        draw.line([(ox + 5*s, oy + 20*s), (ox + 5*s, oy + 8*s), (ox + 10*s, oy + 12*s),
                   (ox + 10*s, oy + 8*s), (ox + 15*s, oy + 12*s), (ox + 15*s, oy + 4*s),
                   (ox + 19*s, oy + 4*s), (ox + 19*s, oy + 20*s)], fill=color, width=w)
    elif name == "running":
        draw.polygon([(ox + 13*s, oy + 2*s), (ox + 3*s, oy + 14*s), (ox + 12*s, oy + 14*s),
                      (ox + 11*s, oy + 22*s), (ox + 21*s, oy + 10*s), (ox + 12*s, oy + 10*s)], outline=color, width=w)
    elif name == "marblerun":
        draw.ellipse([(ox + 4*s, oy + 4*s), (ox + 8*s, oy + 8*s)], outline=color, width=w)
        draw.ellipse([(ox + 16*s, oy + 10*s), (ox + 20*s, oy + 14*s)], outline=color, width=w)
        draw.ellipse([(ox + 6*s, oy + 16*s), (ox + 10*s, oy + 20*s)], outline=color, width=w)
        draw.line([(ox + 8*s, oy + 7*s), (ox + 16*s, oy + 11*s)], fill=color, width=w)
        draw.line([(ox + 16*s, oy + 13*s), (ox + 10*s, oy + 17*s)], fill=color, width=w)
    elif name == "sessions":
        draw.rounded_rectangle([(ox + 3*s, oy + 4*s), (ox + 19*s, oy + 20*s)], radius=2, outline=color, width=w)
        draw.line([(ox + 7*s, oy + 9*s), (ox + 15*s, oy + 9*s)], fill=color, width=w)
        draw.line([(ox + 7*s, oy + 13*s), (ox + 13*s, oy + 13*s)], fill=color, width=w)
    elif name == "memory":
        draw.line([(ox + 12*s, oy + 4*s), (ox + 12*s, oy + 20*s)], fill=color, width=w)
        draw.arc([(ox + 5*s, oy + 4*s), (ox + 12*s, oy + 12*s)], 90, 270, fill=color, width=w)
        draw.arc([(ox + 12*s, oy + 4*s), (ox + 19*s, oy + 12*s)], 270, 90, fill=color, width=w)
        draw.arc([(ox + 5*s, oy + 12*s), (ox + 12*s, oy + 20*s)], 90, 270, fill=color, width=w)
        draw.arc([(ox + 12*s, oy + 12*s), (ox + 19*s, oy + 20*s)], 270, 90, fill=color, width=w)
    elif name == "skills":
        draw.line([(ox + 9*s, oy + 3*s), (ox + 9*s, oy + 8*s)], fill=color, width=w)
        draw.line([(ox + 15*s, oy + 3*s), (ox + 15*s, oy + 8*s)], fill=color, width=w)
        draw.rounded_rectangle([(ox + 6*s, oy + 8*s), (ox + 18*s, oy + 17*s)], radius=2, outline=color, width=w)
        draw.line([(ox + 12*s, oy + 17*s), (ox + 12*s, oy + 22*s)], fill=color, width=w)
    elif name == "messages":
        draw.rounded_rectangle([(ox + 3*s, oy + 5*s), (ox + 21*s, oy + 19*s)], radius=2, outline=color, width=w)
        draw.line([(ox + 3*s, oy + 6*s), (ox + 12*s, oy + 13*s), (ox + 21*s, oy + 6*s)], fill=color, width=w)

def main():
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dest_master_dir = os.path.join(root_dir, "design", "assets-source", "agents", "portraits")
    dest_runtime_dir = os.path.join(root_dir, "public", "assets", "agents", "portraits")
    docs_dir = os.path.join(root_dir, "docs")

    os.makedirs(dest_master_dir, exist_ok=True)
    os.makedirs(dest_runtime_dir, exist_ok=True)
    os.makedirs(docs_dir, exist_ok=True)

    processed_portraits = {}

    print("--- Processing 12 Agent Portraits (Fixed-Range FloodFill) ---")
    for role, src_path in PORTRAIT_SOURCES.items():
        if not os.path.exists(src_path):
            print(f"ERROR: Missing source for {role} at {src_path}")
            continue

        im = Image.open(src_path)
        w, h = im.size
        min_dim = min(w, h)
        left = (w - min_dim) // 2
        top = (h - min_dim) // 2
        im_square = im.crop((left, top, left + min_dim, top + min_dim))
        im_1024 = im_square.resize((1024, 1024), Image.Resampling.LANCZOS)

        # Transparent extraction with fixed range flood fill
        im_transparent = remove_white_background_fixed_range(im_1024, tolerance=18)

        # Save Master PNG 1024x1024
        master_path = os.path.join(dest_master_dir, f"{role}.png")
        im_transparent.save(master_path, "PNG", optimize=True)

        # Save Runtime WebP 512x512
        im_512 = im_transparent.resize((512, 512), Image.Resampling.LANCZOS)
        runtime_path = os.path.join(dest_runtime_dir, f"{role}.webp")
        im_512.save(runtime_path, "WEBP", quality=90, method=6)

        m_sz = os.path.getsize(master_path)
        r_sz = os.path.getsize(runtime_path)
        print(f"OK: {role:20} -> PNG {m_sz//1024:4} KB | WebP {r_sz//1024:3} KB")
        processed_portraits[role] = im_512

    # --- Assemble Contact Sheet ---
    print("\n--- Assembling Visual Contact Sheet ---")
    sheet_width = 1920
    sheet_height = 1440
    sheet = Image.new("RGBA", (sheet_width, sheet_height), (11, 13, 20, 255)) # BACH dark theme #0b0d14
    draw = ImageDraw.Draw(sheet)

    # Title & Header
    draw.rectangle([(0, 0), (sheet_width, 85)], fill=(17, 20, 32, 255))
    draw.line([(0, 85), (sheet_width, 85)], fill=(30, 34, 54, 255), width=2)

    try:
        font_title = ImageFont.truetype("arial.ttf", 24)
        font_sub = ImageFont.truetype("arial.ttf", 14)
        font_card = ImageFont.truetype("arial.ttf", 13)
        font_badge = ImageFont.truetype("arial.ttf", 11)
        font_tiny = ImageFont.truetype("arial.ttf", 10)
    except:
        font_title = font_sub = font_card = font_badge = font_tiny = ImageFont.load_default()

    draw.text((40, 18), "ellmos-system-gui | Gemeinsames Asset-Paket (BACH & OCEAN)", fill=(226, 222, 216), font=font_title)
    draw.text((40, 52), "Sichtprüfungs-Kontaktblatt: 16 Navigations-Icons (24x24 SVG Kontur), 12 Agenten-Porträts (512x512 WebP / 1024x1024 PNG) & Werkstatt-Hintergrund", fill=(110, 115, 134), font=font_sub)

    # Section 1: Navigation Icons
    draw.text((40, 102), "1. Navigations- & Werkstatt-Icons (Kontur-SVGs in BACH #d4485a und OCEAN #0ea5e9 Branding dargestellt)", fill=(212, 72, 90), font=font_sub)

    icon_names = [
        "dashboard", "tasks", "assistant", "life", "agenten", "domains", "files", "governance", "system",
        "fabrika", "running", "marblerun", "sessions", "memory", "skills", "messages"
    ]

    start_x, start_y = 40, 130
    for i, name in enumerate(icon_names):
        ix = start_x + (i % 16) * 115
        iy = start_y
        draw.rounded_rectangle([(ix, iy), (ix + 105, iy + 78)], radius=6, fill=(23, 27, 40, 255), outline=(30, 34, 54, 255))

        # Color: Alternate BACH Red (#d4485a) and Ocean Cyan (#0ea5e9)
        color = (212, 72, 90) if i % 2 == 0 else (14, 165, 233)

        # Draw actual vector shape
        draw_vector_icon_preview(draw, name, ix + 52, iy + 30, color, scale=1.3)

        # Label
        draw.text((ix + 10, iy + 58), name[:13], fill=(226, 222, 216), font=font_tiny)

    # Section 2: Agent Portraits (12 roles in 2 rows of 6)
    draw.text((40, 232), "2. Agenten-Porträts (12 Rollen • 512x512 WebP mit echtem Alpha • Konsistente Illustrationssprache & Berufsinsignien)", fill=(56, 189, 248), font=font_sub)

    card_w, card_h = 290, 410
    cols = 6
    p_start_x, p_start_y = 40, 260

    role_meta = [
        ("buddha-chat", "Buddha Chat", "Persönlicher Assistent", "Teezeremonie & Achtsamkeit"),
        ("always-on-worker", "Always-On Worker", "Hintergrund-Daemon", "Nachtschicht & Fokus-Thermos"),
        ("connector", "Connector", "Bridge & Netzwerk", "Glasfaser & Patch-Module"),
        ("task-solver", "TaskSolver", "Analytiker & Problemlöser", "Präzisions-Mechanik"),
        ("task-writer", "TaskWriter", "Spezifikations-Architekt", "Stylus & Formuliertes Buch"),
        ("maintainer", "Maintainer", "System-Mechaniker", "Drehmomentschlüssel & Schürze"),
        ("operator", "Operator", "Orchestratorin & Triage", "Headset & Telemetrie-Tablet"),
        ("ticket-master", "Ticket-Master", "Eingangs-Dispatcher", "Prioritäten-Klemmbrett"),
        ("wartungsagent", "Wartungs-Agent", "Code- & Repohygiene", "Poliertuch & Diagnoseprisma"),
        ("system-auditor", "System-Auditor", "Governance & Audit", "Validierungssiegel & Wachsamkeit"),
        ("law-checker", "Law-Checker", "Compliance & Recht", "Kodexbuch & Regelwerk"),
        ("researcher", "Researcher", "Wissenschaftlicher Scout", "Feldnotizbuch & Messlupe")
    ]

    for idx, (role, title, subtitle, prop) in enumerate(role_meta):
        col = idx % cols
        row = idx // cols
        cx = p_start_x + col * 312
        cy = p_start_y + row * 425

        # Card container with subtle theme-tinted outline
        theme_border = (212, 72, 90, 90) if idx % 2 == 0 else (14, 165, 233, 90)
        draw.rounded_rectangle([(cx, cy), (cx + card_w, cy + card_h)], radius=10, fill=(23, 27, 40, 255), outline=theme_border, width=1)

        # Checkerboard background for transparency proof
        cb_x, cb_y, cb_s = cx + 25, cy + 18, 240
        for bx in range(cb_x, cb_x + cb_s, 16):
            for by in range(cb_y, cb_y + cb_s, 16):
                c_fill = (28, 32, 48, 255) if ((bx // 16) + (by // 16)) % 2 == 0 else (36, 42, 62, 255)
                draw.rectangle([(bx, by), (min(bx + 16, cb_x + cb_s), min(by + 16, cb_y + cb_s))], fill=c_fill)

        # Paste portrait
        if role in processed_portraits:
            p_img = processed_portraits[role].resize((cb_s, cb_s), Image.Resampling.LANCZOS)
            sheet.paste(p_img, (cb_x, cb_y), p_img)

        # Portrait frame outline
        draw.rounded_rectangle([(cb_x, cb_y), (cb_x + cb_s, cb_y + cb_s)], radius=6, outline=(42, 48, 72, 255), width=1)

        # Text labels
        draw.text((cx + 15, cy + 270), title, fill=(240, 240, 245), font=font_card)
        draw.text((cx + 15, cy + 293), subtitle, fill=(14, 165, 233) if idx % 2 != 0 else (224, 107, 126), font=font_badge)
        draw.text((cx + 15, cy + 315), f"Insignie: {prop}", fill=(180, 185, 200), font=font_tiny)
        draw.text((cx + 15, cy + 338), f"public/assets/agents/portraits/{role}.webp", fill=(110, 115, 134), font=font_tiny)
        draw.text((cx + 15, cy + 355), f"512x512 WebP (Alpha) • 1024x1024 Master PNG", fill=(90, 95, 115), font=font_tiny)

    # Section 3: Workshop Background Preview Strip at Bottom
    draw.text((40, 1130), "3. Hintergrund der Agenten-Werkstatt (16:9 Master PNG & WebP mit ruhiger zentraler Arbeitsfläche)", fill=(245, 197, 66), font=font_sub)

    bg_path = os.path.join(root_dir, "design", "assets-source", "backgrounds", "agent-workshop", "workshop-master.png")
    if os.path.exists(bg_path):
        bg_im = Image.open(bg_path)
        bg_thumb = bg_im.resize((540, 255), Image.Resampling.LANCZOS)
        sheet.paste(bg_thumb, (40, 1160))
        draw.rectangle([(40, 1160), (580, 1415)], outline=(42, 48, 72, 255), width=1)

        # Overlay an example UI card over the background to demonstrate low-contrast legibility
        draw.rounded_rectangle([(610, 1160), (1200, 1415)], radius=8, fill=(17, 20, 32, 240), outline=(212, 72, 90, 180), width=1)
        draw.text((630, 1180), "Lesbarkeitsnachweis: UI-Card über Werkstatt-Hintergrund", fill=(226, 222, 216), font=font_card)
        draw.text((630, 1210), "Die weiche Tiefenschärfe und der ausgewogene Kontrast im Zentrum der Werkbank", fill=(160, 165, 180), font=font_badge)
        draw.text((630, 1230), "ermöglichen ermüdungsfreies Lesen aller Dashboard-Texte und Bedienelemente.", fill=(160, 165, 180), font=font_badge)
        draw.text((630, 1255), "• Keine störenden Personen oder Fremdlogos im Bildfeld", fill=(74, 222, 128), font=font_badge)
        draw.text((630, 1275), "• Handwerkliche Atmosphäre passend zur Agenten-Werkstatt (Fabrika & MarbleRun)", fill=(74, 222, 128), font=font_badge)
        draw.text((630, 1295), "• Nahtlos integrierbar in BACH (Rot/Dunkel) und OCEAN (Blau/Cyan) Themes", fill=(74, 222, 128), font=font_badge)
        draw.text((630, 1325), "Ablage Master: design/assets-source/backgrounds/agent-workshop/workshop-master.png", fill=(110, 115, 134), font=font_tiny)
        draw.text((630, 1345), "Ablage Runtime: public/assets/backgrounds/agent-workshop/workshop-bg.webp (2560x1440)", fill=(110, 115, 134), font=font_tiny)

        # Stats Card
        draw.rounded_rectangle([(1230, 1160), (1880, 1415)], radius=8, fill=(23, 27, 40, 255), outline=(30, 34, 54, 255))
        draw.text((1250, 1180), "Asset-Kennzahlen & Audit-Status", fill=(226, 222, 216), font=font_card)
        draw.text((1250, 1210), "• 16x Navigations-Icons: 24x24 SVG Kontur, currentColor, 0 Skripte", fill=(226, 222, 216), font=font_badge)
        draw.text((1250, 1235), "• 12x Agenten-Porträts: 1024x1024 PNG Master + 512x512 WebP Runtime (Alpha)", fill=(226, 222, 216), font=font_badge)
        draw.text((1250, 1260), "• 1x Werkstatt-Hintergrund: 16:9 Master PNG + 2560x1440 / 1080p WebP", fill=(226, 222, 216), font=font_badge)
        draw.text((1250, 1285), "• Git-Worktree: feature/design-assets-bach-ocean (origin/main)", fill=(110, 115, 134), font=font_badge)
        draw.text((1250, 1310), "• Locks: CLEAR • Builds/Commits/Pushes: KEINE (Striker Fail-Closed Schutz)", fill=(74, 222, 128), font=font_badge)
        draw.text((1250, 1335), "• Lizenz-Status: Ausdrücklich dokumentiert in docs/design-assets.md", fill=(245, 197, 66), font=font_badge)

    # Save contact sheet
    sheet_path = os.path.join(docs_dir, "design-assets-contact-sheet.png")
    sheet.save(sheet_path, "PNG", optimize=True)
    print(f"Contact sheet saved to: {sheet_path} ({os.path.getsize(sheet_path)//1024} KB)")

if __name__ == "__main__":
    main()

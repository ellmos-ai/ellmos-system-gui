"""
Script: generate_icons.py
Generates validated SVG navigation, agent-role, and Life-module icons and Astro components for ellmos-system-gui.
Complies with AUFTRAG 2 specifications:
- 24 x 24 ViewBox
- Uniform stroke width 2
- Rounded line caps and joins
- currentColor stroke, no fill
- No external references or embedded scripts
"""

import os
import xml.etree.ElementTree as ET

ICONS = {
    "dashboard": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="7" height="9" rx="1.5" />
  <rect x="14" y="3" width="7" height="5" rx="1.5" />
  <rect x="14" y="12" width="7" height="9" rx="1.5" />
  <rect x="3" y="16" width="7" height="5" rx="1.5" />
</svg>""",

    "tasks": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="5" y="4" width="14" height="17" rx="2" />
  <path d="M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1z" />
  <path d="m9 11 2 2 4-4" />
  <path d="M9 16h6" />
</svg>""",

    "assistant": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
  <circle cx="12" cy="12" r="4" />
  <path d="m4.93 4.93 2.83 2.83M16.24 16.24l2.83 2.83M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
</svg>""",

    "life": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 22v-8" />
  <path d="M12 14c-4 0-7-3-7-7 0 0 3-1 7 2 4-3 7-2 7-2 0 4-3 7-7 7z" />
  <path d="M12 17c2 0 4-1.5 5-3" />
</svg>""",

    "agenten": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="4" y="8" width="16" height="12" rx="3" />
  <path d="M12 2v6" />
  <circle cx="12" cy="2" r="1" />
  <line x1="8" y1="13" x2="10" y2="13" />
  <line x1="14" y1="13" x2="16" y2="13" />
  <path d="M9 17h6" />
  <path d="M2 14h2M20 14h2" />
</svg>""",

    "domains": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="9" />
  <path d="M3.6 9h16.8" />
  <path d="M3.6 15h16.8" />
  <path d="M11.5 3a17 17 0 0 0 0 18" />
  <path d="M12.5 3a17 17 0 0 1 0 18" />
</svg>""",

    "files": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" />
</svg>""",

    "governance": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  <path d="m9 12 2 2 4-4" />
</svg>""",

    "system": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="3" />
  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
</svg>""",

    "fabrika": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M2 20h20" />
  <path d="M5 20V8l5 4V8l5 4V4h4a1 1 0 0 1 1 1v15" />
  <circle cx="17" cy="8" r="1.5" />
</svg>""",

    "running": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
</svg>""",

    "marblerun": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="6" cy="6" r="3" />
  <circle cx="18" cy="12" r="3" />
  <circle cx="8" cy="19" r="3" />
  <path d="M8.5 7.5 15.5 10.5" />
  <path d="M15.5 13.5 10.5 17.5" />
</svg>""",

    "sessions": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M19 17V5a2 2 0 0 0-2-2H4" />
  <path d="M8 21h11a2 2 0 0 0 2-2v-2" />
  <rect x="2" y="5" width="15" height="16" rx="2" />
  <line x1="6" y1="10" x2="13" y2="10" />
  <line x1="6" y1="14" x2="11" y2="14" />
</svg>""",

    "memory": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M9.5 4a3.5 3.5 0 0 0-3.5 3.5c0 .5.1 1 .3 1.4A4 4 0 0 0 4 12.5a4 4 0 0 0 2.5 3.7A3.5 3.5 0 0 0 10 19.5c.5 0 1-.1 1.5-.3" />
  <path d="M14.5 4a3.5 3.5 0 0 1 3.5 3.5c0 .5-.1 1-.3 1.4A4 4 0 0 1 20 12.5a4 4 0 0 1-2.5 3.7 3.5 3.5 0 0 1-3.5 3.3c-.5 0-1-.1-1.5-.3" />
  <path d="M12 4v16" />
  <path d="M9 9h3" />
  <path d="M12 15h3" />
</svg>""",

    "skills": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 22v-5" />
  <path d="M9 8V3M15 8V3" />
  <rect x="6" y="8" width="12" height="9" rx="2" />
</svg>""",

    "messages": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="5" width="18" height="14" rx="2" />
  <polyline points="3 7 12 13 21 7" />
</svg>"""
}

ROLE_ICONS = {
    "buddha-chat": """<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">
  <path d=\"M8 11h8l1 9H7l1-9z\" />
  <path d=\"M9 11a3 3 0 0 1 6 0M10 6c-1-1 1-2 0-3M14 6c-1-1 1-2 0-3\" />
  <path d=\"M10 16h4\" />
</svg>""",
    "always-on-worker": """<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">
  <path d=\"M18.5 15.5A8 8 0 0 1 8.5 5.2 8.5 8.5 0 1 0 18.5 15.5z\" />
  <path d=\"M17 3v4M15 5h4\" />
  <circle cx=\"18\" cy=\"18\" r=\"2.5\" />
</svg>""",
    "connector": """<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">
  <path d=\"M8 7v4M6 7v4a4 4 0 0 0 4 4h4a4 4 0 0 1 4 4v2\" />
  <path d=\"M5 3v4M9 3v4M15 17v-2a4 4 0 0 1 4-4h1\" />
  <circle cx=\"20\" cy=\"11\" r=\"1\" />
</svg>""",
    "task-solver": """<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">
  <path d=\"M4 4h6v3a2 2 0 1 0 4 0V4h6v6h-3a2 2 0 1 0 0 4h3v6h-6v-3a2 2 0 1 0-4 0v3H4v-6h3a2 2 0 1 0 0-4H4V4z\" />
</svg>""",
    "task-writer": """<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">
  <path d=\"M5 3h10l4 4v8M15 3v5h5M8 12h6M8 16h4\" />
  <path d=\"m14 20 5-5 2 2-5 5-3 1 1-3z\" />
</svg>""",
    "maintainer": """<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">
  <path d=\"M14 6a5 5 0 0 0-6.5 6.5L3 17l4 4 4.5-4.5A5 5 0 0 0 18 10l-3 3-4-4 3-3z\" />
  <path d=\"m5 19 2 2\" />
</svg>""",
    "operator": """<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">
  <rect x=\"4\" y=\"5\" width=\"16\" height=\"14\" rx=\"2\" />
  <path d=\"M8 9h3M8 13h8M8 16h5\" />
  <circle cx=\"16.5\" cy=\"9\" r=\"1\" />
</svg>""",
    "ticket-master": """<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">
  <path d=\"M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4V6z\" />
  <path d=\"M12 7v2M12 12v2M12 17v1\" />
</svg>""",
    "wartungsagent": """<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">
  <path d=\"M14 4a5 5 0 0 0 6 6l-9.5 9.5a2.1 2.1 0 0 1-3-3L17 7a5 5 0 0 0-3-3z\" />
  <path d=\"m5 5 1 1M3 9h2M8 3v2\" />
</svg>""",
    "system-auditor": """<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">
  <path d=\"M12 3 20 6v5c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6l8-3z\" />
  <circle cx=\"11\" cy=\"11\" r=\"2.5\" />
  <path d=\"m13 13 2.5 2.5\" />
</svg>""",
    "law-checker": """<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">
  <path d=\"M12 3v17M5 21h14M4 7h16M12 3l-2 2M12 3l2 2\" />
  <path d=\"m6 7-3 6h6L6 7zM18 7l-3 6h6l-3-6z\" />
  <path d=\"M9 17h6\" />
</svg>""",
    "researcher": """<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">
  <circle cx=\"10.5\" cy=\"10.5\" r=\"6.5\" />
  <path d=\"m15.5 15.5 5 5M8 10.5h5M10.5 8v5\" />
</svg>"""
}

LIFE_ICONS = {
    "calendar": """<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">
  <rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\" />
  <path d=\"M16 3v4M8 3v4M3 10h18\" />
  <path d=\"M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01\" />
</svg>""",
    "routines": """<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">
  <path d=\"M20 7v5h-5\" />
  <path d=\"M4 17v-5h5\" />
  <path d=\"M5.3 9.8A7 7 0 0 1 17 6l3 6\" />
  <path d=\"M18.7 14.2A7 7 0 0 1 7 18l-3-6\" />
</svg>""",
    "financial": """<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">
  <path d=\"M4 7a3 3 0 0 1 3-3h12v4\" />
  <path d=\"M4 7v11a2 2 0 0 0 2 2h14V9H7a3 3 0 0 1-3-2z\" />
  <path d=\"M16 13h5v4h-5a2 2 0 0 1 0-4z\" />
  <path d=\"M17.5 15h.01\" />
</svg>""",
    "balance": """<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">
  <path d=\"M12 3v17M5 21h14M4 7h16M12 3l-2 2M12 3l2 2\" />
  <path d=\"m6 7-3 7h6L6 7zM18 7l-3 7h6l-3-7z\" />
</svg>""",
    "health": """<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">
  <path d=\"M20.8 8.6c0 5.2-8.8 11.2-8.8 11.2S3.2 13.8 3.2 8.6A4.6 4.6 0 0 1 12 6.4a4.6 4.6 0 0 1 8.8 2.2z\" />
  <path d=\"M6.5 12h3l1.5-3 2.2 6 1.3-3h3\" />
</svg>""",
    "focus": """<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">
  <circle cx=\"12\" cy=\"12\" r=\"8.5\" />
  <circle cx=\"12\" cy=\"12\" r=\"3\" />
  <path d=\"M12 2v3M22 12h-3M12 22v-3M2 12h3\" />
</svg>"""
}

def main():
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    icon_groups = {"navigation": ICONS, "roles": ROLE_ICONS, "life": LIFE_ICONS}
    generated_components = {}
    validated_count = 0

    def component_name(name):
        return "".join(part.capitalize() for part in name.split("-")) + "Icon"

    for group, icons in icon_groups.items():
        svg_out_dir = os.path.join(root_dir, "design", "assets-source", "icons", group)
        astro_out_dir = os.path.join(root_dir, "src", "components", "icons", group)
        os.makedirs(svg_out_dir, exist_ok=True)
        os.makedirs(astro_out_dir, exist_ok=True)

        for name, svg_content in icons.items():
            root = ET.fromstring(svg_content)
            assert root.tag.endswith("svg"), f"{group}/{name} invalid SVG root"
            assert root.attrib.get("viewBox") == "0 0 24 24", f"{group}/{name} invalid viewBox"
            assert root.attrib.get("fill") == "none", f"{group}/{name} must use no fill"
            assert root.attrib.get("stroke") == "currentColor", f"{group}/{name} must use currentColor"
            for element in root.iter():
                element_name = element.tag.rsplit("}", 1)[-1].lower()
                assert element_name not in {"script", "foreignobject"}, f"{group}/{name} contains active content"
                for attribute, value in element.attrib.items():
                    attribute_name = attribute.rsplit("}", 1)[-1].lower()
                    assert not attribute_name.startswith("on"), f"{group}/{name} contains an event handler"
                    if attribute_name in {"href", "src"}:
                        assert value.startswith("#"), f"{group}/{name} contains an external reference"
                    assert "javascript:" not in value.lower(), f"{group}/{name} contains a script URL"
                    assert "url(" not in value.lower(), f"{group}/{name} contains a CSS URL"

            svg_file = os.path.join(svg_out_dir, f"{name}.svg")
            with open(svg_file, "w", encoding="utf-8") as f:
                f.write(svg_content.strip() + "\n")

            if group == "roles":
                runtime_role_dir = os.path.join(root_dir, "public", "assets", "agents", "icons")
                os.makedirs(runtime_role_dir, exist_ok=True)
                with open(os.path.join(runtime_role_dir, f"{name}.svg"), "w", encoding="utf-8") as f:
                    f.write(svg_content.strip() + "\n")

            inner_content = svg_content.split(">", 1)[1].rsplit("<", 1)[0].strip()
            comp_name = component_name(name)
            astro_file = os.path.join(astro_out_dir, f"{comp_name}.astro")
            astro_content = f"""---
// {comp_name}.astro - ellmos-system-gui {group} icon ({name})
// ViewBox: 24x24 | Stroke: currentColor | Clean Contour
interface Props {{
  size?: number | string;
  class?: string;
  strokeWidth?: number | string;
}}

const {{ size = 24, class: className = "", strokeWidth = 2 }} = Astro.props;
---

<svg
  xmlns="http://www.w3.org/2000/svg"
  width={{size}}
  height={{size}}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={{strokeWidth}}
  stroke-linecap="round"
  stroke-linejoin="round"
  class={{className}}
  aria-hidden="true"
>
  {inner_content}
</svg>
"""
            with open(astro_file, "w", encoding="utf-8") as f:
                f.write(astro_content)

            generated_components[(group, name)] = comp_name
            validated_count += 1
            print(f"Generated: {group}/{name}.svg and {group}/{comp_name}.astro")

    dispatcher_file = os.path.join(root_dir, "src", "components", "icons", "navigation", "NavIcon.astro")
    dispatcher_imports = []
    dispatcher_cases = []
    for group, icons in icon_groups.items():
        for name in icons:
            comp_name = generated_components[(group, name)]
            import_path = f"./{comp_name}.astro" if group == "navigation" else f"../{group}/{comp_name}.astro"
            dispatcher_imports.append(f'import {comp_name} from "{import_path}";')
            dispatcher_cases.append(f'  name === "{name}" ? <{comp_name} {{...rest}} /> :')

    imports_text = "\n".join(dispatcher_imports)
    cases_text = "\n".join(dispatcher_cases)
    dispatcher_content = f"""---
// NavIcon.astro - Dispatcher for navigation, workshop, and Life-module icons
{imports_text}

interface Props {{
  name: string;
  size?: number | string;
  class?: string;
  strokeWidth?: number | string;
}}

const {{ name, ...rest }} = Astro.props;
---

{{
{cases_text}
  null
}}
"""
    with open(dispatcher_file, "w", encoding="utf-8") as f:
        f.write(dispatcher_content)
    print(f"Generated dispatcher: NavIcon.astro ({validated_count} icons)")

if __name__ == "__main__":
    main()

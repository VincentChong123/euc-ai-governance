import yaml
import re
from pathlib import Path

YAML_PATH = Path("../../specs/prompt-records-schema.yaml")
JS_PATH = Path("note_schema.js")

def generate_js_from_yaml():
    print(f"Reading schema from {YAML_PATH}...")
    with open(YAML_PATH, 'r') as f:
        spec = yaml.safe_load(f)

    versions = spec.get('versions', {})
    current_version = "v2"

    js_lines = []

    # 1. Determine current version
    for v_key, v_data in versions.items():
        if v_data.get('status') == 'current':
            current_version = v_key

    js_lines.append(f'NOTE_SCHEMA.CURRENT_VERSION = "{current_version}";\n')

    # 2. Generate column arrays for each version
    for v_key, v_data in versions.items():
        v_upper = v_key.upper()
        columns_dict = v_data.get('columns', {})

        # Sort by column letter (A, B, C...)
        # Note: simplistic sort works for A-Z.
        sorted_letters = sorted(columns_dict.keys(), key=lambda x: (len(x), x))

        js_lines.append(f'// ── {v_upper} column order — MUST match specs/prompt-records-schema.yaml exactly ─')
        js_lines.append(f'NOTE_SCHEMA.AUDIT_SHEET_COLUMN.{v_upper} = [')

        for i, letter in enumerate(sorted_letters):
            col_info = columns_dict[letter]
            col_name = col_info.get('name')
            comma = "," if i < len(sorted_letters) - 1 else ""
            js_lines.append(f'  "{col_name}"{comma}   // {letter}')

        js_lines.append("];\n")

    generated_code = "\n".join(js_lines)

    print("\n--- GENERATED JAVASCRIPT ---")
    print(generated_code)
    print("----------------------------\n")

    return generated_code, current_version

def update_js_file(generated_code, current_version):
    print(f"Updating {JS_PATH}...")
    with open(JS_PATH, 'r') as f:
        js_content = f.read()

    # Regex to replace NOTE_SCHEMA.CURRENT_VERSION = "vX";
    js_content = re.sub(
        r'NOTE_SCHEMA\.CURRENT_VERSION\s*=\s*"[^"]+";',
        f'NOTE_SCHEMA.CURRENT_VERSION = "{current_version}";',
        js_content
    )

    # Replace the V2_COLUMNS (or any Vx_COLUMNS) arrays.
    # To be safe and simple, we can look for the start of V2_COLUMNS and replace.
    # For a robust approach, we will inject it if we use marker comments,
    # but here we'll just overwrite the existing NOTE_SCHEMA.V2_COLUMNS block.

    # Remove existing V2_COLUMNS block
    js_content = re.sub(
        r'// ── V2 column order[\s\S]*?\];',
        '/* __INJECT_COLUMNS__ */',
        js_content
    )

    # If V1_COLUMNS exists, remove it too
    js_content = re.sub(
        r'// ── V1 column order[\s\S]*?\];',
        '',
        js_content
    )

    # Insert the new generated columns array
    columns_only_code = generated_code.split(';\n\n')[1] if ';\n\n' in generated_code else generated_code

    # We strip out the CURRENT_VERSION line from the columns_only_code since we already regex'd it
    columns_only_code = re.sub(r'NOTE_SCHEMA\.CURRENT_VERSION.*?\n', '', generated_code)

    js_content = js_content.replace('/* __INJECT_COLUMNS__ */', columns_only_code.strip())

    with open(JS_PATH, 'w') as f:
        f.write(js_content)

    print(f"✅ Successfully updated {JS_PATH}!")

if __name__ == "__main__":
    try:
        import yaml
    except ImportError:
        print("Please install pyyaml: pip install pyyaml")
        exit(1)

    code, curr_v = generate_js_from_yaml()
    update_js_file(code, curr_v)

# wrapper injected by judge (single test execution for central comparator mode)
import base64, json, sys, traceback

# --- Security: Restrict dangerous modules and built-ins ---
for module_name in [
    'os', 'subprocess', 'shutil', 'socket', 'urllib', 'requests',
    'pathlib', 'glob', 'tempfile', 'mmap', 'fcntl', 'resource', 'signal',
    'ctypes', 'gc', 'inspect', 'site', 'distutils', 'setuptools', 'pip'
]:
    if module_name in sys.modules:
        del sys.modules[module_name]
    if module_name in globals():
        del globals()[module_name]

restricted_builtins = ['__import__', 'eval', 'exec', 'compile', 'open', 'file', 'input']
for builtin_name in restricted_builtins:
    if hasattr(__builtins__, builtin_name):
        delattr(__builtins__, builtin_name)

# USER_CODE_MARKER

def run_one():
    try:
        if len(sys.argv) < 2:
            print(json.dumps({"error": "missing input payload"}))
            sys.stdout.flush()
            return

        decoded = base64.b64decode(sys.argv[1]).decode("utf-8")
        payload = json.loads(decoded)

        test_input = payload.get("inputs", [])
        if isinstance(test_input, list):
            out = {{FUNCTION_NAME}}(*test_input)
        elif isinstance(test_input, dict):
            out = {{FUNCTION_NAME}}(**test_input)
        else:
            out = {{FUNCTION_NAME}}(test_input)

        print(json.dumps({"output": out}))
        sys.stdout.flush()
    except Exception as e:
        tb = traceback.format_exc()
        print(json.dumps({"error": str(e), "traceback": tb}))
        sys.stdout.flush()

if __name__ == "__main__":
    run_one()

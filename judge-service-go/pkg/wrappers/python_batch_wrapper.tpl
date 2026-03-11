# wrapper injected by judge (batched execution for central comparator mode)
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

def emit(payload):
    print(json.dumps(payload), flush=True)

def run_all():
    if len(sys.argv) < 2:
        emit({"fatal": "missing tests payload"})
        return 2

    decoded = base64.b64decode(sys.argv[1]).decode("utf-8")
    tests = json.loads(decoded)

    for i, test in enumerate(tests):
        try:
            test_input = test.get("inputs", [])
            if isinstance(test_input, list):
                out = {{FUNCTION_NAME}}(*test_input)
            elif isinstance(test_input, dict):
                out = {{FUNCTION_NAME}}(**test_input)
            else:
                out = {{FUNCTION_NAME}}(test_input)
            emit({"test": i + 1, "output": out})
        except Exception as exc:
            emit({
                "test": i + 1,
                "error": str(exc),
                "traceback": traceback.format_exc(),
            })

    return 0

if __name__ == "__main__":
    try:
        sys.exit(run_all())
    except Exception as exc:
        emit({
            "fatal": str(exc),
            "traceback": traceback.format_exc(),
        })
        sys.exit(1)

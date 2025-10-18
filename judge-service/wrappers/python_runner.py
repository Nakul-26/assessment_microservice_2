import sys
import json
import os

def main():
    user_code_path = sys.argv[1]
    function_name = sys.argv[2]
    args_json = sys.argv[3]

    with open(user_code_path, 'r') as f:
        user_code = f.read()

    # It's important to un-escape newlines that might have been escaped
    user_code = user_code.replace('\\n', '\n')

    # Create a scope for the exec call
    exec_scope = {}
    try:
        exec(user_code, exec_scope)
    except Exception as e:
        print(f"Error during exec: {e}", file=sys.stderr)
        sys.exit(1)

    func = exec_scope.get(function_name)
    if not func:
        print(f"Function '{function_name}' not found in user code.", file=sys.stderr)
        sys.exit(1)

    try:
        args = json.loads(args_json)
        # We assume the arguments are passed as a dictionary (kwargs)
        result = func(**args)
        print(json.dumps(result))
    except Exception as e:
        print(f"Error during function execution or JSON processing: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()

import sys
import json
import subprocess
import os

def main():
    input_json = sys.argv[1]
    data = json.loads(input_json)
    code = data['code']
    function_name = data['functionName']
    input_data = data['input']

    # Create a temporary file to store the user's code
    with open('user_code.py', 'w') as f:
        f.write(code)
        f.write('\n')
        f.write(f'print(json.dumps({function_name}(**{json.dumps(input_data)})))')

    try:
        result = subprocess.run(
            ['python', 'user_code.py'],
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0:
            print(result.stdout.strip())
        else:
            print(result.stderr.strip(), file=sys.stderr)
            sys.exit(1)
    except subprocess.TimeoutExpired:
        print("Execution timed out", file=sys.stderr)
        sys.exit(1)
    finally:
        os.remove('user_code.py')

if __name__ == "__main__":
    main()
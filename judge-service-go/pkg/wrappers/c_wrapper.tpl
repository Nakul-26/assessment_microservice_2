#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <json-c/json.h>

// The user's implementation file is included.
// IMPORTANT: the user must *NOT* define main() in their submission.
// Required function signature expected by this harness:
//    long {{FUNCTION_NAME}}(long *args, int argc);
#include "main.c"

static void make_error_and_print(const char *msg) {
    struct json_object *out = json_object_new_object();
    json_object_object_add(out, "status", json_object_new_string("error"));
    json_object_object_add(out, "message", json_object_new_string(msg));
    printf("%s\n", json_object_to_json_string(out));
    json_object_put(out);
}

int main(void) {
    const char* tests_json_str = getenv("TESTS_JSON");
    if (!tests_json_str) {
        make_error_and_print("TESTS_JSON environment variable not set");
        return 2;
    }

    struct json_object *parsed_json = json_tokener_parse(tests_json_str);
    if (!parsed_json) {
        make_error_and_print("Invalid JSON in TESTS_JSON");
        return 3;
    }

    if (!json_object_is_type(parsed_json, json_type_array)) {
        make_error_and_print("TESTS_JSON must be a JSON array of test objects");
        json_object_put(parsed_json);
        return 4;
    }

    int num_tests = json_object_array_length(parsed_json);
    int passed_tests = 0;

    // Prepare final JSON result object
    struct json_object *result = json_object_new_object();
    struct json_object *details = json_object_new_array();

    for (int i = 0; i < num_tests; i++) {
        struct json_object *test_case = json_object_array_get_idx(parsed_json, i);
        if (!test_case || !json_object_is_type(test_case, json_type_object)) {
            // skip invalid test entries but record failure
            struct json_object *tr = json_object_new_object();
            json_object_object_add(tr, "test", json_object_new_int(i+1));
            json_object_object_add(tr, "ok", json_object_new_boolean(0));
            json_object_object_add(tr, "error", json_object_new_string("invalid test case object"));
            json_object_array_add(details, tr);
            continue;
        }

        struct json_object *input_obj = json_object_object_get(test_case, "inputs");
        struct json_object *expected_obj = json_object_object_get(test_case, "expected");

        // We expect "input" to be a JSON array; if not, try to handle single primitive as single-element array.
        struct json_object *input_arr = NULL;
        if (input_obj && json_object_is_type(input_obj, json_type_array)) {
            input_arr = input_obj;
        } else if (input_obj) {
            // wrap single input into an array
            input_arr = json_object_new_array();
            json_object_array_add(input_arr, json_object_get(input_obj));
        } else {
            // missing input
            input_arr = json_object_new_array(); // empty
        }

        // Convert inputs to long array (best-effort). For more types extend this logic.
        int argc = json_object_array_length(input_arr);
        long *args = NULL;
        if (argc > 0) {
            args = (long*)malloc(sizeof(long) * argc);
            if (!args) {
                json_object_put(parsed_json);
                json_object_put(details);
                json_object_put(result);
                make_error_and_print("memory allocation failure");
                return 5;
            }
            for (int j = 0; j < argc; j++) {
                struct json_object *elem = json_object_array_get_idx(input_arr, j);
                if (elem && json_object_is_type(elem, json_type_int)) {
                    args[j] = json_object_get_int64(elem);
                } else if (elem && json_object_is_type(elem, json_type_double)) {
                    args[j] = (long)json_object_get_double(elem);
                } else if (elem && json_object_is_type(elem, json_type_string)) {
                    // attempt to parse string as long
                    const char *s = json_object_get_string(elem);
                    args[j] = strtoll(s, NULL, 10);
                } else {
                    // unsupported type -> default 0
                    args[j] = 0;
                }
            }
        }

        // Call user function
        long output_val = {{FUNCTION_NAME}}(args, argc);

        // Build test result object
        struct json_object *tr = json_object_new_object();
        json_object_object_add(tr, "test", json_object_new_int(i+1));

        // Put output as number
        json_object_object_add(tr, "output", json_object_new_int64(output_val));

        // Put expected: best-effort: if expected_obj is numeric use numeric, else stringify
        if (expected_obj && json_object_is_type(expected_obj, json_type_int)) {
            long expected_val = json_object_get_int64(expected_obj);
            json_object_object_add(tr, "expected", json_object_new_int64(expected_val));
            int ok = (output_val == expected_val);
            json_object_object_add(tr, "ok", json_object_new_boolean(ok));
            if (ok) passed_tests++;
        } else if (expected_obj && json_object_is_type(expected_obj, json_type_double)) {
            long expected_val = (long)json_object_get_double(expected_obj);
            json_object_object_add(tr, "expected", json_object_new_int64(expected_val));
            int ok = (output_val == expected_val);
            json_object_object_add(tr, "ok", json_object_new_boolean(ok));
            if (ok) passed_tests++;
        } else {
            // fallback: stringify expected
            const char *expected_str = expected_obj ? json_object_to_json_string(expected_obj) : "null";
            json_object_object_add(tr, "expected", json_object_new_string(expected_str));
            // We can't reliably compare, so set ok to 0 unless stringified numeric matches
            json_object_object_add(tr, "ok", json_object_new_boolean(0));
        }

        json_object_array_add(details, tr);

        if (argc > 0) {
            free(args);
            args = NULL;
        }
        // if we wrapped input_obj into a new array, free it
        if (input_obj && !json_object_is_type(input_obj, json_type_array)) {
            json_object_put(input_arr);
        }
    }

    // Build result
    json_object_object_add(result, "status", json_object_new_string("finished"));
    json_object_object_add(result, "passed", json_object_new_int(passed_tests));
    json_object_object_add(result, "total", json_object_new_int(num_tests));
    json_object_object_add(result, "details", details);

    // Print final JSON (single well-formed object)
    printf("%s\n", json_object_to_json_string(result));

    // Clean up
    json_object_put(parsed_json);
    json_object_put(result);

    return 0;
}
